import { utcDay, utcDayFromUnix } from "./utc-day.js";

const MAX_SIGNAL_AGE_SEC = 24 * 60 * 60;

export const TELEMETRY_COUNTER_MAX = 500;

export interface InstallSignals {
  opens: number;
  timeouts: number;
  serverErrors: number;
  signInFailures: number;
}

export function emptyInstallSignals(): InstallSignals {
  return {
    opens: 0,
    timeouts: 0,
    serverErrors: 0,
    signInFailures: 0,
  };
}

export function clampInstallCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(TELEMETRY_COUNTER_MAX, Math.floor(value));
}

export function installSignalsFrom(input: Partial<InstallSignals> | null | undefined): InstallSignals {
  return {
    opens: clampInstallCount(input?.opens ?? 0),
    timeouts: clampInstallCount(input?.timeouts ?? 0),
    serverErrors: clampInstallCount(input?.serverErrors ?? 0),
    signInFailures: clampInstallCount(input?.signInFailures ?? 0),
  };
}

/** Later pings can raise a counter. They cannot erase one. */
export function mergeInstallSignals(previous: InstallSignals | null, incoming: InstallSignals): InstallSignals {
  const next = installSignalsFrom(incoming);
  if (!previous) return next;
  const prior = installSignalsFrom(previous);
  return {
    opens: Math.max(prior.opens, next.opens),
    timeouts: Math.max(prior.timeouts, next.timeouts),
    serverErrors: Math.max(prior.serverErrors, next.serverErrors),
    signInFailures: Math.max(prior.signInFailures, next.signInFailures),
  };
}

/**
 * Bucket a ping by the UTC day of its unix timestamp. A timestamp more than
 * 24 hours old, or in the future, counts as presence on the server's today
 * and drops the counters.
 */
export function resolveSignalTimestamp(
  ts: number,
  now: Date,
): { day: string; keepSignals: boolean } {
  const today = utcDay(now);
  const nowSec = Math.floor(now.getTime() / 1000);
  if (!Number.isInteger(ts) || ts > nowSec || nowSec - ts > MAX_SIGNAL_AGE_SEC) {
    return { day: today, keepSignals: false };
  }
  return { day: utcDayFromUnix(ts), keepSignals: true };
}
