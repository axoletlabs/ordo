export const TELEMETRY_FLUSH_GAP_MS = 15 * 60 * 1000;
export const TELEMETRY_COUNTER_MAX = 500;

export interface TelemetryCounters {
  day: string;
  opens: number;
  timeouts: number;
  serverErrors: number;
  signInFailures: number;
}

export type TelemetryNote = "open" | "timeout" | "serverError" | "signInFailure";

export function emptyTelemetryCounters(day: string): TelemetryCounters {
  return {
    day,
    opens: 0,
    timeouts: 0,
    serverErrors: 0,
    signInFailures: 0,
  };
}

/** Explicit allowlist so stored metadata never leaks into a request. */
export function telemetryHeartbeat(installId: string, counters: TelemetryCounters) {
  return {
    installId,
    day: counters.day,
    opens: counters.opens,
    timeouts: counters.timeouts,
    serverErrors: counters.serverErrors,
    signInFailures: counters.signInFailures,
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
    timeouts: clampTelemetryCount(source.timeouts),
    serverErrors: clampTelemetryCount(source.serverErrors),
    signInFailures: clampTelemetryCount(source.signInFailures),
  };
}

export function countsAsSignInFailure(status: number): boolean {
  return status >= 400 && status < 500;
}

/** Later notes can raise a counter. They cannot erase one. */
export function applyTelemetryNote(counters: TelemetryCounters, note: TelemetryNote): TelemetryCounters {
  switch (note) {
    case "open":
      return { ...counters, opens: bumpTelemetryCount(counters.opens) };
    case "timeout":
      return { ...counters, timeouts: bumpTelemetryCount(counters.timeouts) };
    case "serverError":
      return { ...counters, serverErrors: bumpTelemetryCount(counters.serverErrors) };
    case "signInFailure":
      return { ...counters, signInFailures: bumpTelemetryCount(counters.signInFailures) };
    default:
      return counters;
  }
}

export function telemetryDirty(current: TelemetryCounters, ack: TelemetryCounters | null): boolean {
  const signaled =
    current.opens > 0 ||
    current.timeouts > 0 ||
    current.serverErrors > 0 ||
    current.signInFailures > 0;
  if (!ack || ack.day !== current.day) return signaled;
  return (
    current.opens > ack.opens ||
    current.timeouts > ack.timeouts ||
    current.serverErrors > ack.serverErrors ||
    current.signInFailures > ack.signInFailures
  );
}

/**
 * Send at least once per UTC day. Send sooner when a new count exists, after
 * the flush gap, so a problem later the same day is not held until tomorrow.
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

/**
 * Stable production builds only. Dev sessions and any channel other than
 * `production` (preview, development) never ping or store counters.
 */
export function telemetryEnabled(dev: boolean, channel: string | null): boolean {
  return !dev && channel === "production";
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
