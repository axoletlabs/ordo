/**
 * Pure rules for access-token lifetime and 401 handling.
 *
 * The wire format only has `expiresIn` (seconds from issuance). Persisting that
 * number and treating it as remaining time after a later launch would schedule
 * refresh far too late. Clients stamp an absolute `accessExpiresAt` instead.
 *
 * Rotating refresh tokens invalidate the previous access token. In-flight
 * requests then come back as 401 `unauthorized` (hash miss) rather than
 * `token_expired`. Those must refresh, not sign the user out.
 */
export const ACCESS_REFRESH_LEAD_MS = 60_000;

export function accessExpiresAtFromNow(expiresInSec: number, now = Date.now()): number {
  return now + Math.max(0, expiresInSec) * 1000;
}

/** Refresh when expiry is unknown (legacy persist) or within the lead window. */
export function shouldRefreshAccessToken(
  accessExpiresAt: number | null | undefined,
  now = Date.now(),
): boolean {
  if (accessExpiresAt == null || !Number.isFinite(accessExpiresAt)) return true;
  return accessExpiresAt - now <= ACCESS_REFRESH_LEAD_MS;
}

/** Milliseconds until a proactive refresh. 0 means refresh immediately. */
export function nextProactiveRefreshDelayMs(accessExpiresAt: number, now = Date.now()): number {
  return Math.max(0, accessExpiresAt - ACCESS_REFRESH_LEAD_MS - now);
}

export function shouldRetryRequestWithRefresh(
  err: { status: number; code: string },
  opts: { auth: boolean; retried: boolean },
): boolean {
  if (!opts.auth || opts.retried) return false;
  if (err.code === "token_expired") return true;
  return err.status === 401 && err.code === "unauthorized";
}

/**
 * Only our own auth rejections drop the session. A proxy 401 with no code,
 * a timeout, or a 5xx must not sign the user out.
 */
export function isDefiniteRefreshRejection(err: { status: number; code: string }): boolean {
  if (err.code === "session_revoked") return true;
  if (err.status !== 401) return false;
  return err.code === "unauthorized" || err.code === "token_expired";
}

/** Don't drop a newly rotated session because an in-flight request used the old access token. */
export function shouldClearSessionForError(
  err: { status: number; code: string },
  opts: { sentAccessToken?: string | null; currentAccessToken?: string | null },
): boolean {
  if (err.code !== "session_revoked") return false;
  if (!opts.currentAccessToken || !opts.sentAccessToken) return true;
  return opts.sentAccessToken === opts.currentAccessToken;
}
