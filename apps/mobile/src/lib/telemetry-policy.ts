import type { TelemetryPlatform } from "@ordo/shared";

export const TELEMETRY_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const TELEMETRY_FLUSH_GAP_MS = 15 * 60 * 1000;
export const TELEMETRY_COUNTER_MAX = 500;

export interface TelemetryCounters {
  day: string;
  opens: number;
  loggedIn: boolean;
  registered: boolean;
  timeouts: number;
  serverErrors: number;
  signInFailures: number;
  startupFast: number;
  startupOk: number;
  startupSlow: number;
}

export type TelemetryNote =
  | "open"
  | "loggedIn"
  | "registered"
  | "timeout"
  | "serverError"
  | "signInFailure"
  | "startupFast"
  | "startupOk"
  | "startupSlow";

export function emptyTelemetryCounters(day: string): TelemetryCounters {
  return {
    day,
    opens: 0,
    loggedIn: false,
    registered: false,
    timeouts: 0,
    serverErrors: 0,
    signInFailures: 0,
    startupFast: 0,
    startupOk: 0,
    startupSlow: 0,
  };
}

export function clampTelemetryCount(value: unknown, max = TELEMETRY_COUNTER_MAX): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(max, Math.floor(number));
}

export function bumpTelemetryCount(value: number, max = TELEMETRY_COUNTER_MAX): number {
  return Math.min(max, clampTelemetryCount(value, max) + 1);
}

export function countersForDay(counters: TelemetryCounters, day: string): TelemetryCounters {
  return counters.day === day ? counters : emptyTelemetryCounters(day);
}

export function normalizeTelemetryCounters(raw: unknown, fallbackDay: string): TelemetryCounters {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const day =
    typeof source.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.day) ? source.day : fallbackDay;
  return {
    day,
    opens: clampTelemetryCount(source.opens),
    loggedIn: source.loggedIn === true,
    registered: source.registered === true,
    timeouts: clampTelemetryCount(source.timeouts),
    serverErrors: clampTelemetryCount(source.serverErrors),
    signInFailures: clampTelemetryCount(source.signInFailures),
    startupFast: clampTelemetryCount(source.startupFast),
    startupOk: clampTelemetryCount(source.startupOk),
    startupSlow: clampTelemetryCount(source.startupSlow),
  };
}

/** Under a second, under three seconds, or slower. */
export function startupBucket(elapsedMs: number): "fast" | "ok" | "slow" {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1000) return "fast";
  if (elapsedMs < 3000) return "ok";
  return "slow";
}

export function countsAsSignInFailure(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * Sign-in does not imply registration, and registration does not imply sign-in.
 * A registration session is counted only as a registration.
 */
export function applyTelemetryNote(counters: TelemetryCounters, note: TelemetryNote): TelemetryCounters {
  switch (note) {
    case "open":
      return { ...counters, opens: bumpTelemetryCount(counters.opens) };
    case "loggedIn":
      return { ...counters, loggedIn: true };
    case "registered":
      return { ...counters, registered: true };
    case "timeout":
      return { ...counters, timeouts: bumpTelemetryCount(counters.timeouts) };
    case "serverError":
      return { ...counters, serverErrors: bumpTelemetryCount(counters.serverErrors) };
    case "signInFailure":
      return { ...counters, signInFailures: bumpTelemetryCount(counters.signInFailures) };
    case "startupFast":
      return { ...counters, startupFast: bumpTelemetryCount(counters.startupFast) };
    case "startupOk":
      return { ...counters, startupOk: bumpTelemetryCount(counters.startupOk) };
    case "startupSlow":
      return { ...counters, startupSlow: bumpTelemetryCount(counters.startupSlow) };
    default:
      return counters;
  }
}

export function telemetryDirty(current: TelemetryCounters, ack: TelemetryCounters | null): boolean {
  const signaled =
    current.opens > 0 ||
    current.loggedIn ||
    current.registered ||
    current.timeouts > 0 ||
    current.serverErrors > 0 ||
    current.signInFailures > 0 ||
    current.startupFast > 0 ||
    current.startupOk > 0 ||
    current.startupSlow > 0;
  if (!ack || ack.day !== current.day) return signaled;
  return (
    current.opens > ack.opens ||
    (current.loggedIn && !ack.loggedIn) ||
    (current.registered && !ack.registered) ||
    current.timeouts > ack.timeouts ||
    current.serverErrors > ack.serverErrors ||
    current.signInFailures > ack.signInFailures ||
    current.startupFast > ack.startupFast ||
    current.startupOk > ack.startupOk ||
    current.startupSlow > ack.startupSlow
  );
}

/**
 * Send at least once per UTC day. Send sooner when a new count exists, after
 * the flush gap, so a sign-in later the same day is not held until tomorrow.
 */
export function shouldFlushTelemetry(input: {
  lastPingAt: number | null;
  ackDay: string | null;
  today: string;
  now: number;
  dirty: boolean;
  force: boolean;
  immediate?: boolean;
  gapMs?: number;
}): boolean {
  if (input.force || input.immediate) return true;
  const gap = input.gapMs ?? TELEMETRY_FLUSH_GAP_MS;
  const lastPingAt = input.lastPingAt;
  const unseenToday = lastPingAt == null || input.ackDay !== input.today;
  if (unseenToday) return input.dirty || lastPingAt == null;
  if (!input.dirty) return false;
  if (lastPingAt > input.now) return true;
  return input.now - lastPingAt >= gap;
}

export interface TelemetryWebHints {
  userAgent?: string;
  maxTouchPoints?: number;
}

export function shouldPing(
  lastPingAt: number | null,
  now: number,
  intervalMs = TELEMETRY_PING_INTERVAL_MS,
): boolean {
  if (lastPingAt == null || lastPingAt > now) return true;
  return now - lastPingAt >= intervalMs;
}

/**
 * Native APK/IPA stay android/ios. A browser on a phone is web-android /
 * web-ios so Chrome-on-Android is not counted as the Android app. The user
 * agent never leaves the device — only this bucket is sent.
 */
export function telemetryPlatform(
  os: string,
  hints: TelemetryWebHints = {},
): TelemetryPlatform {
  if (os === "android" || os === "ios") return os;
  if (os !== "web") return "other";
  const ua = hints.userAgent?.trim();
  if (!ua) return "web";
  return webSurface(ua, hints.maxTouchPoints ?? 0);
}

/**
 * Production builds only. Dev servers, emulators, and `expo start` sessions
 * never ping, so local development does not inflate install counts.
 */
export function telemetryEnabled(dev: boolean): boolean {
  return !dev;
}

export function needsTelemetryRegistration(savedRevision: number | undefined, revision: number): boolean {
  return savedRevision !== revision;
}

export function existingOrNewInstallId(
  saved: string | null | undefined,
  mint: () => string,
): string {
  if (typeof saved === "string" && isTelemetryInstallId(saved)) return saved;
  return mint();
}

export function isTelemetryInstallId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function webSurface(userAgent: string, maxTouchPoints: number): TelemetryPlatform {
  const hay = userAgent.toLowerCase();
  if (hay.includes("electron")) return "desktop";
  if (/iphone|ipod/.test(hay)) return "web-ios";
  if (/ipad/.test(hay) || (hay.includes("mac") && maxTouchPoints > 1)) return "web-ios";
  if (hay.includes("android")) return "web-android";
  if (hay.includes("mobile") && !hay.includes("ipad")) return "web";
  return "web-desktop";
}
