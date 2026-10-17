/** Long enough to perceive the refresh, without delaying the updated data. */
export const REFRESH_MIN_VISIBLE_MS = 700;

export function refreshHoldRemaining(startedAt: number, now: number): number {
  return Math.max(0, REFRESH_MIN_VISIBLE_MS - Math.max(0, now - startedAt));
}
