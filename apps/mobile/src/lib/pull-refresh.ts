/**
 * Shared pull-to-refresh physics for lists and the in-app website.
 * Finger travel must clear PTR_THRESHOLD before a release commits.
 */

/** Finger travel (px) before a release starts a refresh. */
export const PTR_THRESHOLD = 72;

/** How far the chip may travel while dragging. */
export const PTR_MAX_FOLLOW = 72;

/** Progress 0–1 of the arming pull. */
export function ptrProgress(dy: number): number {
  return Math.min(1, Math.max(0, dy) / PTR_THRESHOLD);
}

/** Fade in over the first part of the pull so the chip does not pop. */
export function ptrHudOpacity(dy: number, refreshing: boolean): number {
  if (refreshing) return 1;
  if (dy <= 0) return 0;
  return Math.min(1, ptrProgress(dy) / 0.32);
}

/** Follow the finger with a bit of rubber-band past the threshold. */
export function ptrHudTranslateY(dy: number): number {
  const raw = Math.max(0, dy);
  if (raw <= PTR_THRESHOLD) return raw * 0.55;
  return Math.min(PTR_MAX_FOLLOW, PTR_THRESHOLD * 0.55 + (raw - PTR_THRESHOLD) * 0.18);
}

/** Grow from a seed to full size as the pull arms. */
export function ptrHudScale(dy: number, refreshing: boolean): number {
  if (refreshing) return 1;
  return 0.4 + ptrProgress(dy) * 0.6;
}

/** Drag-driven rotation (deg) until refresh takes over and the arc spins. */
export function ptrPullRotation(dy: number): number {
  return ptrProgress(dy) * 270;
}

export function shouldCommitPtr(dy: number, refreshing: boolean): boolean {
  return !refreshing && dy >= PTR_THRESHOLD;
}

/** iOS list bounce past the top. Android reports 0. */
export function listRefreshOverscrollDy(contentOffsetY: number): number {
  return contentOffsetY < 0 ? -contentOffsetY : 0;
}

export function listIsAtTop(contentOffsetY: number): boolean {
  return contentOffsetY <= 1;
}
