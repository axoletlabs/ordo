import { addUtcDays } from "./utc-day.js";

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
 * Counters may land on today or yesterday so a flush just after midnight
 * still belongs to the day they were counted. Any other day only refreshes
 * today's presence and drops the counters.
 */
export function resolveSignalDay(
  day: string | undefined,
  today: string,
): { day: string; keepSignals: boolean } {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { day: today, keepSignals: true };
  if (day === today || day === addUtcDays(today, -1)) return { day, keepSignals: true };
  return { day: today, keepSignals: false };
}
