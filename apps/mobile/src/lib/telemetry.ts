/**
 * Anonymous install ping to ordo Cloud.
 * Counts installs, opens, sign-ins, registrations, and coarse health.
 * Sign-in and registration are separate. No account, email, IP, device name,
 * or server URL.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Updates from "expo-updates";
import { TelemetryRoutes, type TelemetryHeartbeatInput } from "@ordo/shared";
import { CLOUD_SERVER_URL, resolvePersistedServerUrl, telemetryHosting } from "./hosting";
import { prefsGet, prefsSet, StorageKeys } from "./storage";
import { useSettingsStore } from "../store/settings";
import { useOnlineStore } from "./online";
import {
  REQUEST_HARD_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  createTimeoutSignal,
  raceDeadline,
} from "./fetch-timeout";
import {
  applyTelemetryNote,
  countersForDay,
  existingOrNewInstallId,
  isTelemetryInstallId,
  needsTelemetryRegistration,
  normalizeTelemetryCounters,
  shouldFlushTelemetry,
  startupBucket,
  telemetryDirty,
  telemetryEnabled,
  telemetryPlatform,
  TELEMETRY_FLUSH_GAP_MS,
  type TelemetryCounters,
  type TelemetryNote,
  type TelemetryWebHints,
} from "./telemetry-policy";

const TELEMETRY_REVISION = 3;

interface StoredTelemetry {
  installId: string;
  lastPingAt: number | null;
  telemetryRevision?: number;
  counters?: TelemetryCounters;
  ack?: TelemetryCounters | null;
}

let inflight: Promise<void> | null = null;
let lastAttemptAt = 0;
let cachedInstallId: string | null = null;
let coldStartRecorded = false;
let chain: Promise<void> = Promise.resolve();
let buildChannel: string | null | undefined;

/** EAS channel baked into the binary. Read once; it does not change at runtime. */
function readBuildChannel(): string | null {
  if (buildChannel === undefined) {
    try {
      const channel = Updates.channel;
      buildChannel = typeof channel === "string" ? channel : null;
    } catch {
      buildChannel = null;
    }
  }
  return buildChannel;
}

function reportingEnabled(): boolean {
  return telemetryEnabled(__DEV__, readBuildChannel());
}

export { shouldFlushTelemetry, startupBucket, telemetryPlatform } from "./telemetry-policy";

export function telemetryAppVersion(): string {
  const version = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  return version.trim().slice(0, 32) || "unknown";
}

export function recordColdStart(elapsedMs: number, now = Date.now()): Promise<void> {
  if (!reportingEnabled()) return Promise.resolve();
  if (coldStartRecorded) return pingCloudTelemetry(now);
  coldStartRecorded = true;
  const bucket = startupBucket(elapsedMs);
  const startup: TelemetryNote = bucket === "fast" ? "startupFast" : bucket === "ok" ? "startupOk" : "startupSlow";
  return record((counters) => applyTelemetryNote(applyTelemetryNote(counters, "open"), startup), now);
}

export function recordForeground(now = Date.now()): Promise<void> {
  if (!reportingEnabled()) return Promise.resolve();
  return record((counters) => applyTelemetryNote(counters, "open"), now);
}

export function noteLoggedIn(now = Date.now()): void {
  if (!reportingEnabled()) return;
  void record((counters) => applyTelemetryNote(counters, "loggedIn"), now);
}

export function noteRegistered(now = Date.now()): void {
  if (!reportingEnabled()) return;
  void record((counters) => applyTelemetryNote(counters, "registered"), now);
}

export function noteTimeout(now = Date.now()): void {
  if (!reportingEnabled()) return;
  void record((counters) => applyTelemetryNote(counters, "timeout"), now);
}

export function noteServerError(now = Date.now()): void {
  if (!reportingEnabled()) return;
  void record((counters) => applyTelemetryNote(counters, "serverError"), now);
}

export function noteSignInFailure(now = Date.now()): void {
  if (!reportingEnabled()) return;
  void record((counters) => applyTelemetryNote(counters, "signInFailure"), now);
}

export async function pingCloudTelemetry(now = Date.now(), followUp = false): Promise<void> {
  if (!reportingEnabled()) return;
  if (inflight) {
    await inflight;
    if (followUp) return;
    return pingCloudTelemetry(now, true);
  }
  inflight = runPing(now).finally(() => {
    inflight = null;
  });
  return inflight;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function record(mutate: (counters: TelemetryCounters) => TelemetryCounters, now: number): Promise<void> {
  if (!reportingEnabled()) return;
  const saved = await enqueue(() => loadStored(now));
  if (pendingPreviousDay(saved, utcDay(now))) await pingCloudTelemetry(now);
  await enqueue(async () => {
    const latest = await loadStored(now);
    const today = utcDay(now);
    const next = mutate(countersForDay(latest.counters, today));
    await prefsSet(StorageKeys.TELEMETRY, { ...latest, counters: next });
  });
  await pingCloudTelemetry(now);
}

async function runPing(now: number): Promise<void> {
  if (!reportingEnabled()) return;
  if (!useOnlineStore.getState().online) return;

  const prepared = await enqueue(() => preparePing(now));
  if (!prepared) return;
  if (now - lastAttemptAt < TELEMETRY_FLUSH_GAP_MS && !prepared.immediate) return;
  lastAttemptAt = now;

  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await raceDeadline(
      fetch(`${CLOUD_SERVER_URL}${TelemetryRoutes.heartbeat.path}`, {
        method: TelemetryRoutes.heartbeat.method,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(prepared.payload),
        credentials: "omit",
        signal: timeout.signal,
      }),
      REQUEST_HARD_TIMEOUT_MS,
    );
    if (!response.ok) return;
    await enqueue(async () => {
      const saved = await loadStored(now);
      await prefsSet(StorageKeys.TELEMETRY, {
        ...saved,
        installId: prepared.installId,
        lastPingAt: now,
        telemetryRevision: TELEMETRY_REVISION,
        ack: prepared.counters,
      });
    });
  } catch {
    /* best-effort — retry on a later launch; install id is already saved */
  } finally {
    timeout.clear();
  }
}

async function preparePing(now: number): Promise<{
  installId: string;
  counters: TelemetryCounters;
  payload: TelemetryHeartbeatInput;
  immediate: boolean;
} | null> {
  const saved = await loadStored(now);
  const today = utcDay(now);
  const installId = resolveInstallId(saved.installId);
  const previousDay = pendingPreviousDay(saved, today);
  const counters = previousDay ? saved.counters : countersForDay(saved.counters, today);
  if (saved.installId !== installId) {
    await prefsSet(StorageKeys.TELEMETRY, { ...saved, installId });
  }
  const ack = saved.ack?.day === counters.day ? saved.ack : null;
  const force = needsTelemetryRegistration(saved.telemetryRevision, TELEMETRY_REVISION);
  const dirty = telemetryDirty(counters, ack);
  const immediate = previousDay || authPending(counters, ack);
  if (
    !shouldFlushTelemetry({
      lastPingAt: saved.lastPingAt,
      ackDay: saved.ack?.day ?? null,
      today: counters.day,
      now,
      dirty,
      force,
      immediate,
    })
  ) {
    return null;
  }

  const payload: TelemetryHeartbeatInput = {
    installId,
    platform: telemetryPlatform(Platform.OS, webHints()),
    hosting: telemetryHosting(await resolveServerUrl()),
    appVersion: telemetryAppVersion(),
    ts: reportTs(counters.day, now),
    opens: counters.opens,
    loggedIn: counters.loggedIn,
    registered: counters.registered,
    timeouts: counters.timeouts,
    serverErrors: counters.serverErrors,
    signInFailures: counters.signInFailures,
    startupFast: counters.startupFast,
    startupOk: counters.startupOk,
    startupSlow: counters.startupSlow,
  };
  return { installId, counters, payload, immediate };
}

function pendingPreviousDay(saved: StoredTelemetry & { counters: TelemetryCounters }, today: string): boolean {
  return saved.counters.day !== today && telemetryDirty(saved.counters, saved.ack?.day === saved.counters.day ? saved.ack : null);
}

function authPending(counters: TelemetryCounters, ack: TelemetryCounters | null): boolean {
  return (counters.loggedIn && !ack?.loggedIn) || (counters.registered && !ack?.registered);
}

async function loadStored(now: number): Promise<StoredTelemetry & { counters: TelemetryCounters }> {
  const saved = await prefsGet<StoredTelemetry>(StorageKeys.TELEMETRY);
  const today = utcDay(now);
  const installId = resolveInstallId(saved?.installId);
  const stored = {
    installId,
    lastPingAt: typeof saved?.lastPingAt === "number" ? saved.lastPingAt : null,
    telemetryRevision: saved?.telemetryRevision,
    counters: normalizeTelemetryCounters(saved?.counters, today),
    ack: saved?.ack ? normalizeTelemetryCounters(saved.ack, saved.ack.day || today) : null,
  };
  if (saved?.installId !== installId) await prefsSet(StorageKeys.TELEMETRY, stored);
  return stored;
}

function resolveInstallId(savedId: string | undefined): string {
  if (cachedInstallId && isTelemetryInstallId(cachedInstallId)) return cachedInstallId;
  const id = existingOrNewInstallId(savedId, () => Crypto.randomUUID());
  cachedInstallId = id;
  return id;
}

function webHints(): TelemetryWebHints {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return {};
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

async function resolveServerUrl(): Promise<string> {
  const settings = useSettingsStore.getState();
  if (settings.hydrated) return settings.serverUrl;
  const saved = await prefsGet<{ serverUrl?: string }>(StorageKeys.SETTINGS);
  return resolvePersistedServerUrl(saved?.serverUrl);
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Unix seconds on the counter's UTC day, so a flush just after midnight still lands there. */
function reportTs(day: string, nowMs: number): number {
  const nowSec = Math.floor(nowMs / 1000);
  const start = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000);
  if (!Number.isFinite(start)) return nowSec;
  return Math.min(start + 86_400 - 1, Math.max(start, nowSec));
}
