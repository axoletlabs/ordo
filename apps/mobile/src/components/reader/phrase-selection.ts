/** A caret is start === end. Highlights only exist for a real range. */
export function selectedRange(
  start: number,
  end: number,
): { start: number; end: number } | null {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (to <= from) return null;
  return { start: from, end: to };
}
