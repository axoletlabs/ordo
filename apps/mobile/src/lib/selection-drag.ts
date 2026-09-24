/**
 * Range selection while a pointer drags across library rows, plus the
 * auto-scroll step when that pointer sits in the list's edge bands.
 */

export type SelectionDragMode = "select" | "deselect";

export interface SelectionRowFrame {
  top: number;
  bottom: number;
}

export const SELECTION_DRAG_SLOP = 12;
export const SELECTION_DRAG_FLICK = 1.05;
export const SELECTION_DRAG_EDGE = 72;

export function keysAfterDrag(
  keys: readonly string[],
  baseline: ReadonlySet<string>,
  anchorKey: string,
  currentIndex: number,
  mode: SelectionDragMode,
): string[] | null {
  const anchorIndex = keys.indexOf(anchorKey);
  if (anchorIndex < 0 || currentIndex < 0 || currentIndex >= keys.length) return null;
  const next = new Set(baseline);
  const start = Math.min(anchorIndex, currentIndex);
  const end = Math.max(anchorIndex, currentIndex);
  for (let i = start; i <= end; i++) {
    const key = keys[i];
    if (key == null) continue;
    if (mode === "select") next.add(key);
    else next.delete(key);
  }
  return [...next];
}

export function sameSelection(current: ReadonlySet<string>, next: readonly string[]): boolean {
  if (current.size !== next.length) return false;
  for (const key of next) {
    if (!current.has(key)) return false;
  }
  return true;
}

/** Index of the mounted row under `y`, or the nearest mounted row. */
export function indexAtPoint(
  keys: readonly string[],
  frames: ReadonlyMap<string, SelectionRowFrame>,
  y: number,
): number | null {
  let nearest: { index: number; dist: number } | null = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key == null) continue;
    const frame = frames.get(key);
    if (!frame || frame.bottom <= frame.top) continue;
    if (y >= frame.top && y < frame.bottom) return i;
    const mid = (frame.top + frame.bottom) / 2;
    const dist = Math.abs(y - mid);
    if (!nearest || dist < nearest.dist) nearest = { index: i, dist };
  }
  return nearest?.index ?? null;
}

/** Pixels to add to the scroll offset this frame. Negative scrolls toward the start. */
export function autoScrollStep(
  pointerY: number,
  viewportTop: number,
  viewportBottom: number,
  edge = SELECTION_DRAG_EDGE,
): number {
  if (viewportBottom <= viewportTop || edge <= 0) return 0;
  if (pointerY < viewportTop + edge) {
    const depth = Math.min(1, (viewportTop + edge - pointerY) / edge);
    return -Math.round(6 + depth * 22);
  }
  if (pointerY > viewportBottom - edge) {
    const depth = Math.min(1, (pointerY - (viewportBottom - edge)) / edge);
    return Math.round(6 + depth * 22);
  }
  return 0;
}

export function shouldClaimSelectionDrag(
  dx: number,
  dy: number,
  elapsedMs: number,
): boolean {
  if (Math.abs(dy) < SELECTION_DRAG_SLOP) return false;
  if (Math.abs(dx) > Math.abs(dy)) return false;
  const speed = Math.abs(dy) / Math.max(elapsedMs, 1);
  return speed <= SELECTION_DRAG_FLICK;
}
