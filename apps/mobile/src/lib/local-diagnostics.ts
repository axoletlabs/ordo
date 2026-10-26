/** Production diagnostics: local, bounded, explicitly shared. No network imports. */
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { NativeModules, Platform } from "react-native";
import { createMMKV, type MMKV } from "react-native-mmkv";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { createDiagnosticRecorder } from "./diagnostics/recorder";
import { ISSUE_LABELS, MAX_AGE_MS, normalizeFrameStats, normalizeRenderState, normalizeNativeEvidence, type EvidenceStatus, type DiagnosticEventName, type ErrorKind, type SafeError, type OperationArea, type OperationOutcome } from "./diagnostics/schema";

interface NativeDiagnostics {
  diagnosticsApiVersion?: number;
  recordingEnabled?: boolean;
  cutoffTimestamp?: number;
  recordingGeneration?: number;
  configureRecording(enabled: boolean, cutoffMs: number, generation: number): Promise<boolean>;
  cancelDiagnosticCapture(generation: number): Promise<unknown>;
  collectSafeEvidence(sinceMs: number, generation: number): Promise<unknown>;
  captureSafeFrameStats(durationMs: number, generation: number): Promise<unknown>;
  getSafeRenderState(generation: number): Promise<unknown>;
}
const native: NativeDiagnostics | undefined = Platform.OS === "android" && NativeModules.OrdoDiagnostics?.diagnosticsApiVersion === 2
  ? NativeModules.OrdoDiagnostics : undefined;
let storage: MMKV | undefined;
let recorder: ReturnType<typeof createDiagnosticRecorder> | undefined;
let installed = false;
let timer: ReturnType<typeof setInterval> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let captureBusy = false;
let captureKind: "frames" | "render" | null = null;
const captureListeners = new Set<() => void>();
export type DiagnosticCheckStatus = "idle" | "running" | "complete" | "partial" | "cancelled" | "unavailable";
let checkStatus: DiagnosticCheckStatus = "idle";
let checkOwner: { generation: number } | null = null;
let reportBusy = false;
let nativeReady: Promise<unknown> = Promise.resolve();
const cancelListeners = new Set<() => void>();
const reportListeners = new Set<() => void>();
const cleanupListeners = new Set<() => void>();
let prepared: PreparedDiagnosticReport | null = null;
let reportEpoch = 0;

function disk() {
  if (!storage) storage = createMMKV({ id: "ordo-diagnostics", ...(Platform.OS === "ios" && FileSystem.cacheDirectory
    ? { path: `${FileSystem.cacheDirectory.replace(/^file:\/\//, "")}ordo-diagnostics` } : {}) });
  return storage;
}
function read(key: string): string | undefined {
  if (Platform.OS === "ios" && key === "policy-v2") return SecureStore.getItem("ordo.diagnostics.policy") ?? undefined;
  if (Platform.OS === "web") return globalThis.localStorage.getItem(`ordo.diagnostics.${key}`) ?? undefined;
  return disk().getString(key);
}
function write(key: string, value: string) {
  if (Platform.OS === "ios" && key === "policy-v2") { SecureStore.setItem("ordo.diagnostics.policy", value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); return; }
  if (Platform.OS === "web") { globalThis.localStorage.setItem(`ordo.diagnostics.${key}`, value); return; }
  const store = disk();
  store.set(key, value);
  if (store.size > 1024 * 1024) store.trim();
}
function remove(key: string) {
  if (Platform.OS === "ios" && key === "policy-v2") return;
  if (Platform.OS === "web") { globalThis.localStorage.removeItem(`ordo.diagnostics.${key}`); return; }
  const store = disk();
  store.remove(key);
  if (key === "records-v2" || key === "report-v1") store.trim();
}
function buildFacts() {
  try { return { version: Constants.nativeAppVersion ?? Constants.expoConfig?.version,
    commit: Constants.expoConfig?.extra?.ordo?.gitHash ?? Constants.expoConfig?.extra?.ordo?.gitHashShort,
    platform: Platform.OS, osVersion: typeof Platform.Version === "number" ? Platform.Version : Number.parseInt(Platform.Version, 10),
    origin: __DEV__ ? "development" : Updates.isEmbeddedLaunch ? "embedded" : "update" }; }
  catch { return { platform: Platform.OS }; }
}
function current() {
  if (!recorder) {
    // Native reads its persisted policy before React exists. If it was disabled,
    // a missing JS preference must never turn it back on during initialization.
    if (native?.recordingEnabled === false) {
      try { write("policy-v2", JSON.stringify({ enabled: false, cutoff: native.cutoffTimestamp ?? Date.now() })); } catch { /* The recorder fails closed on storage errors. */ }
    }
    recorder = createDiagnosticRecorder({ wall: Date.now, monotonic: () => performance.now(), read, write, remove,
      schedule: (callback, ms) => setTimeout(callback, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, buildFacts(), (native?.recordingGeneration ?? 0) + 1,
      native ? Math.max(Date.now() - MAX_AGE_MS, native.cutoffTimestamp ?? Date.now()) : undefined);
  }
  return recorder;
}
export const getDiagnosticStatus = () => current().status();
/** Remove the former iOS Documents/MMKV raw report, never read or migrate it. */
export async function removeLegacyDiagnosticFiles() {
  if (Platform.OS !== "ios" || !FileSystem.documentDirectory) return;
  await Promise.all(["ordo-diagnostics", "ordo-diagnostics.crc"].map(name =>
    FileSystem.deleteAsync(`${FileSystem.documentDirectory}mmkv/${name}`, { idempotent: true }).catch(() => {})));
}
export const subscribeDiagnostics = (listener: () => void) => current().subscribe(listener);
export const getDiagnosticSnapshot = () => current().snapshot();
export const flushLocalDiagnostics = () => current().flush();
export const nativeDiagnosticsAvailable = () => !!native;
export const getDiagnosticReportEpoch = () => reportEpoch;
export function registerDiagnosticCancellation(cleanup: () => void) { cleanupListeners.add(cleanup); return () => { cleanupListeners.delete(cleanup); }; }

function publishReport() { reportListeners.forEach(listener => { try { listener(); } catch { /* Subscriber isolation. */ } }); }
export function discardPreparedDiagnosticReport() { prepared = null; publishReport(); }
function invalidate(revokeReports = false) {
  clearInterval(timer); clearTimeout(deadline); timer = undefined; deadline = undefined;
  if (checkOwner) { checkOwner = null; publishCheck("cancelled"); }
  if (revokeReports) publishCheck("idle");
  if (revokeReports) { reportEpoch++; discardPreparedDiagnosticReport(); }
  cancelListeners.forEach(cancel => cancel());
  if (revokeReports) cleanupListeners.forEach(cleanup => { try { cleanup(); } catch { /* Cleanup isolation. */ } });
  const state = current().status();
  // Invoke immediately: revocation must reach native even if a previous
  // persistence promise has not resolved. Native applies policy before IO.
  if (native) {
    try { nativeReady = Promise.resolve(native.configureRecording(state.enabled, state.cutoff, state.generation)).catch(() => false); }
    catch { nativeReady = Promise.resolve(false); }
  }
}
function armClock() {
  clearInterval(timer); clearTimeout(deadline);
  const remaining = current().status().remainingSeconds;
  if (!remaining) return;
  timer = setInterval(() => {
    const wasDetailed = current().status().mode === "detailed";
    current().tick();
    if (wasDetailed && current().status().mode !== "detailed") invalidate();
  }, 1000);
  deadline = setTimeout(stopDetailedDiagnostics, remaining * 1000);
}
export function setLocalDiagnosticsEnabled(enabled: boolean) { current().setEnabled(enabled); invalidate(true); }
export function clearLocalDiagnostics() { current().clear(); invalidate(true); }
export function resetAccountDiagnostics() { clearLocalDiagnostics(); }
export function startDetailedDiagnostics() { current().startDetailed(); invalidate(); armClock(); }
export function stopDetailedDiagnostics() { current().stopDetailed(); invalidate(); }
export function setDiagnosticOverlay(key: "status" | "performance" | "rendering" | "layout", enabled: boolean) { current().overlay(key, enabled); }
export function markDiagnosticIssue() { recordDiagnosticEvent("issue.marked"); current().flush(); }
export function recordDiagnosticEvent(event: DiagnosticEventName, detail?: unknown) {
  try {
    current().event(event, detail);
    if (event === "app.state" && detail !== "active") { current().background(); invalidate(); }
  } catch { /* Evidence must not change application behavior. */ }
}
export function recordDiagnosticOperation(area: OperationArea, outcome: OperationOutcome, durationMs: number) {
  recordDiagnosticEvent("operation", `${area}.${outcome} ${durationMs < 100 ? "fast" : durationMs < 1000 ? "normal" : "slow"}`);
}
export async function withDiagnosticOperation<T>(area: OperationArea, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { const result = await work(); recordDiagnosticOperation(area, "ok", performance.now() - started); return result; }
  catch (error) { recordDiagnosticOperation(area, "failed", performance.now() - started); throw error; }
}
export const getDiagnosticCapture = () => captureKind;
export const getDiagnosticCheck = () => checkStatus;
export function subscribeDiagnosticCapture(listener: () => void) { captureListeners.add(listener); return () => { captureListeners.delete(listener); }; }
function publishCapture(kind: typeof captureKind) { captureKind = kind; captureListeners.forEach(listener => { try { listener(); } catch { /* Observer isolation. */ } }); }
function publishCheck(status: DiagnosticCheckStatus) { checkStatus = status; publishCapture(captureKind); }

export type LocalErrorReport = SafeError & { message: string };
export function captureLocalError(error: unknown, kind: ErrorKind, fatal = false, _componentStack = ""): LocalErrorReport | null {
  try { const normalized = current().error(error, kind, fatal); return normalized ? { ...normalized, message: ISSUE_LABELS[normalized.code] } : null; }
  catch { return null; }
}
export function localDiagnosticReport() { return JSON.stringify(current().snapshot(), null, 2); }

async function bounded<T>(work: Promise<T>, ms: number, token: number): Promise<T | { status: "timed-out" | "cancelled" }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  try {
    return await Promise.race([work, new Promise<{ status: "timed-out" | "cancelled" }>(resolve => {
      cancel = () => resolve({ status: "cancelled" }); cancelListeners.add(cancel);
      timeout = setTimeout(() => {
        resolve({ status: "timed-out" });
        if (native) void native.cancelDiagnosticCapture(token).catch(() => {});
      }, ms);
    })]);
  } finally { clearTimeout(timeout); cancelListeners.delete(cancel); }
}

async function collectDiagnosticMeasurement(kind: "frames" | "render", durationMs = 15_000): Promise<EvidenceStatus> {
  const state = current().status();
  if (!native || state.mode !== "detailed" || captureBusy || reportBusy) return "unavailable";
  captureBusy = true;
  publishCapture(kind);
  const token = state.generation;
  try {
    if (await bounded(nativeReady, 2000, token) !== true) return "unavailable";
    if (current().status().generation !== token || current().status().mode !== "detailed") return "cancelled";
    const duration = Math.max(250, Math.min(60_000, state.remainingSeconds * 1000, durationMs));
    const value = await bounded(kind === "frames" ? native.captureSafeFrameStats(duration, token) : native.getSafeRenderState(token), kind === "frames" ? duration + 1500 : 2000, token);
    const safe = kind === "frames" ? normalizeFrameStats(value) : normalizeRenderState(value);
    current().measurement(kind, safe, token);
    return current().status().generation === token ? safe.status : "cancelled";
  } catch { current().measurement(kind, { status: "unavailable" }, token); return "unavailable"; }
  finally { captureBusy = false; publishCapture(null); }
}
export async function captureDiagnosticMeasurement(kind: "frames" | "render", durationMs = 15_000) {
  const status = await collectDiagnosticMeasurement(kind, durationMs);
  return status === "complete" || status === "partial";
}

/** One explicit action owns the entire check, even after its screen unmounts. */
export async function runDiagnosticPerformanceCheck(): Promise<Exclude<DiagnosticCheckStatus, "idle" | "running"> | "busy"> {
  if (checkOwner || captureBusy || reportBusy) return "busy";
  if (!native || !current().status().enabled) return "unavailable";
  startDetailedDiagnostics();
  const owner = { generation: current().status().generation };
  checkOwner = owner;
  publishCheck("running");
  setDiagnosticOverlay("status", true);
  setDiagnosticOverlay("performance", true);
  try {
    const frames = await collectDiagnosticMeasurement("frames");
    if (checkOwner !== owner) return "cancelled";
    const render = await collectDiagnosticMeasurement("render");
    if (checkOwner !== owner) return "cancelled";
    const usable = (status: EvidenceStatus) => status === "complete" || status === "partial";
    const result = frames === "complete" && render === "complete" ? "complete"
      : usable(frames) || usable(render) ? "partial" : "unavailable";
    checkOwner = null;
    stopDetailedDiagnostics();
    current().flush();
    publishCheck(result);
    return result;
  } finally {
    // A cancelled or superseded check must never stop a newer capture.
    if (checkOwner === owner) { checkOwner = null; stopDetailedDiagnostics(); publishCheck("unavailable"); }
  }
}

export interface ReportSelection { actions: boolean; errors: boolean; measurements: boolean; native: boolean }
export const DEFAULT_REPORT_SELECTION: ReportSelection = { actions: true, errors: true, measurements: true, native: true };
export interface PreparedDiagnosticReport {
  id: string; generation: number; oneTime: boolean;
  snapshot: ReturnType<typeof getDiagnosticSnapshot>;
  native: ReturnType<typeof normalizeNativeEvidence>;
}
export const getPreparedDiagnosticReport = () => prepared;
export function subscribePreparedDiagnosticReport(listener: () => void) { reportListeners.add(listener); return () => { reportListeners.delete(listener); }; }
function freezeReport<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeReport);
    Object.freeze(value);
  }
  return value;
}
export async function prepareDiagnosticReport(): Promise<PreparedDiagnosticReport | null> {
  // Reports must not cancel or freeze an in-progress check before it is saved.
  if (reportBusy || captureBusy || checkOwner) return null;
  reportBusy = true;
  const state = current().status(), token = state.generation;
  const snapshot = current().snapshot();
  try {
    let evidence: unknown = { status: "unavailable" };
    if (state.enabled && native) {
      if (await bounded(nativeReady, 2000, token) !== true) throw new Error("Native diagnostics unavailable");
      if (current().status().generation !== token) return null;
      await bounded(native.cancelDiagnosticCapture(token), 2000, token);
      evidence = await bounded(native.collectSafeEvidence(state.cutoff, token), 8000, token);
    }
    if (current().status().generation !== token) return null;
    prepared = freezeReport({ id: Math.random().toString(36).slice(2, 12), generation: reportEpoch, oneTime: !state.enabled, snapshot, native: normalizeNativeEvidence(evidence) });
    publishReport(); return prepared;
  } catch {
    if (current().status().generation !== token) return null;
    prepared = freezeReport({ id: Math.random().toString(36).slice(2, 12), generation: reportEpoch, oneTime: !state.enabled, snapshot, native: normalizeNativeEvidence({ status: "unavailable" }) });
    publishReport(); return prepared;
  } finally { reportBusy = false; }
}
export function serializeDiagnosticReport(report: PreparedDiagnosticReport, selection: ReportSelection = DEFAULT_REPORT_SELECTION) {
  if (report !== prepared || report.generation !== reportEpoch) return null;
  return JSON.stringify({ version: 2, policyVersion: report.snapshot.policyVersion, reportId: report.id,
    oneTime: report.oneTime, build: report.snapshot.build,
    ...(!report.oneTime && selection.actions ? { sessions: report.snapshot.sessions } : {}),
    ...(!report.oneTime && selection.errors ? { issues: report.snapshot.issues } : {}),
    ...(!report.oneTime && selection.measurements ? { measurements: report.snapshot.measurements } : {}),
    ...(!report.oneTime && selection.native ? { android: report.native } : {}),
  }, null, 2);
}
/** Emergency fallback compatibility. Normal UI prepares once and reviews it. */
export async function collectLocalDiagnosticReport() {
  const report = await prepareDiagnosticReport(); return report ? serializeDiagnosticReport(report) ?? localDiagnosticReport() : localDiagnosticReport();
}
export function installLocalErrorRecording() {
  if (installed) return;
  installed = true;
  current(); invalidate(); recordDiagnosticEvent("runtime.started");
  const errors = (globalThis as typeof globalThis & { ErrorUtils?: {
    getGlobalHandler(): (error: unknown, fatal?: boolean) => void;
    setGlobalHandler(handler: (error: unknown, fatal?: boolean) => void): void;
  } }).ErrorUtils;
  if (!errors) return;
  const previous = errors.getGlobalHandler();
  errors.setGlobalHandler((error, fatal) => {
    try { captureLocalError(error, "uncaught-js", fatal === true); }
    finally { previous(error, fatal); }
  });
}
