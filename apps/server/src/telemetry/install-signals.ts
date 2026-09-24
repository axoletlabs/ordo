import { utcDay, utcDayFromUnix } from "./utc-day.js";

const MAX_SIGNAL_AGE_SEC = 24 * 60 * 60;

export const TELEMETRY_COUNTER_MAX = 500;

export interface InstallSignals {
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

export function emptyInstallSignals(): InstallSignals {
  return {
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

export function clampInstallCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(TELEMETRY_COUNTER_MAX, Math.floor(value));
}

export function installSignalsFrom(input: Partial<InstallSignals> | null | undefined): InstallSignals {
  return {
    opens: clampInstallCount(input?.opens ?? 0),
    loggedIn: input?.loggedIn === true,
    registered: input?.registered === true,
    timeouts: clampInstallCount(input?.timeouts ?? 0),
    serverErrors: clampInstallCount(input?.serverErrors ?? 0),
    signInFailures: clampInstallCount(input?.signInFailures ?? 0),
    startupFast: clampInstallCount(input?.startupFast ?? 0),
    startupOk: clampInstallCount(input?.startupOk ?? 0),
    startupSlow: clampInstallCount(input?.startupSlow ?? 0),
  };
}

/** Later pings can raise a counter or set a flag. They cannot erase one. */
export function mergeInstallSignals(previous: InstallSignals | null, incoming: InstallSignals): InstallSignals {
  const next = installSignalsFrom(incoming);
  if (!previous) return next;
  const prior = installSignalsFrom(previous);
  return {
    opens: Math.max(prior.opens, next.opens),
    loggedIn: prior.loggedIn || next.loggedIn,
    registered: prior.registered || next.registered,
    timeouts: Math.max(prior.timeouts, next.timeouts),
    serverErrors: Math.max(prior.serverErrors, next.serverErrors),
    signInFailures: Math.max(prior.signInFailures, next.signInFailures),
    startupFast: Math.max(prior.startupFast, next.startupFast),
    startupOk: Math.max(prior.startupOk, next.startupOk),
    startupSlow: Math.max(prior.startupSlow, next.startupSlow),
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
