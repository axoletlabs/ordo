/** Map a vertical scroll offset to a 0–1 reading fraction. */
export function scrollReadingProgress(
  offset: number,
  viewportHeight: number,
  contentHeight: number,
): number {
  if (viewportHeight <= 0 || contentHeight <= 0) return 0;
  const scrollable = contentHeight - viewportHeight;
  if (scrollable <= 0) return 1;
  if (offset <= 0) return 0;
  if (offset >= scrollable) return 1;
  return offset / scrollable;
}

/** Persist when the user has moved far enough, in either direction. */
export function shouldFlushReadingProgress(
  next: number,
  last: number | null,
  delta: number,
  completion: number,
): boolean {
  if (last === null) return true;
  if (next >= completion) return true;
  return Math.abs(next - last) >= delta;
}
