/** In-memory rate-limit policies. Numbers are part of the public threat model. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export interface WindowPolicy {
  limit: number;
  windowMs: number;
}

/** Failed logins against one account (identifier and/or user id). */
export const LOGIN_ACCOUNT = {
  /** Failures allowed before the first lockout. */
  maxFailures: 5,
  /** Lock duration after the 5th, 6th, … failure. Caps at the last entry. */
  lockMs: [15 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE],
  /** Unused failure records expire after this idle period (unless still locked). */
  idleResetMs: 60 * MINUTE,
} as const;

export const RATE_LIMIT = {
  loginIp: { limit: 20, windowMs: 15 * MINUTE } satisfies WindowPolicy,
  registerIp: { limit: 5, windowMs: HOUR } satisfies WindowPolicy,
  forgotPasswordEmail: { limit: 3, windowMs: HOUR } satisfies WindowPolicy,
  forgotPasswordIp: { limit: 10, windowMs: HOUR } satisfies WindowPolicy,
  resetPasswordIp: { limit: 10, windowMs: 15 * MINUTE } satisfies WindowPolicy,
  bookmarkCreateUser: { limit: 30, windowMs: MINUTE } satisfies WindowPolicy,
  bookmarkPrefetchUser: { limit: 60, windowMs: MINUTE } satisfies WindowPolicy,
  /** Wrong folder PIN / pattern / password (unlock or remove-lock) per user and folder. */
  folderUnlockUser: { limit: 10, windowMs: 15 * MINUTE } satisfies WindowPolicy,
  mfaVerifyIp: { limit: 30, windowMs: 15 * MINUTE } satisfies WindowPolicy,
  avatarUploadUser: { limit: 10, windowMs: HOUR } satisfies WindowPolicy,
  importUploadUser: { limit: 10, windowMs: HOUR } satisfies WindowPolicy,
  exportUser: { limit: 30, windowMs: HOUR } satisfies WindowPolicy,
} as const;

export const RATE_LIMIT_MAX_KEYS = 20_000;
export const RATE_LIMIT_SWEEP_MS = 60 * SECOND;

export function formatRetryAfter(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.max(1, Math.ceil(s / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export function rateLimitMessage(action: string, retryAfterSeconds: number): string {
  return `Too many ${action}. Try again in ${formatRetryAfter(retryAfterSeconds)}.`;
}
