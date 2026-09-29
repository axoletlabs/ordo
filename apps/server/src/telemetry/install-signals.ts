import { addUtcDays, dayStartUtc, utcDay } from "./utc-day.js";

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
 * Accept today or yesterday for a midnight/offline flush. Older or future
 * reports must not manufacture presence or a problem-free report for today.
 */
export function resolveSignalDay(day: string, now: Date): string | null {
  const today = utcDay(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = dayStartUtc(day);
  if (!Number.isFinite(date.getTime()) || utcDay(date) !== day) return null;
  return day >= addUtcDays(today, -1) && day <= today ? day : null;
}
