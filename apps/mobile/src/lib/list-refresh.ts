/** Same rest point as the website HUD (`BROWSER_PTR_THRESHOLD`). */
const LIST_REFRESH_REST_DY = 72;

/** Hold the list HUD at the same rest point as the website reload chip. */
export function listRefreshHudDy(refreshing: boolean, overscrollDy: number): number {
  if (refreshing) return LIST_REFRESH_REST_DY;
  return Math.max(0, overscrollDy);
}

/** Finger travel past the top of a bouncing list (iOS). Android reports 0. */
export function listRefreshOverscrollDy(contentOffsetY: number): number {
  return contentOffsetY < 0 ? -contentOffsetY : 0;
}
