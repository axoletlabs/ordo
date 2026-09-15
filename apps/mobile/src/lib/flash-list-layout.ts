/**
 * FlashList v2 layout helpers.
 *
 * v2 estimates unmeasured rows at 200px and keeps per-index heights across
 * data updates. Deleting a bookmark shrinks the array without invalidating
 * that cache, so remaining rows sit in oversized slots (blank gaps). A
 * leftover `minHeight` on the cell then locks the next onLayout to the
 * stale size. Bookmark lists are not chat threads — drop the default
 * "keep visible position" behavior and rebuild layout when the list shrinks.
 */

export type FlashListCellLayoutStyle = {
  minHeight?: unknown;
  maxHeight?: unknown;
  [key: string]: unknown;
};

/** True when items were removed (delete), not appended (pagination). */
export function shouldClearFlashListLayout(
  previousLength: number | null,
  nextLength: number,
): boolean {
  return previousLength != null && nextLength < previousLength;
}

/**
 * Strip min/max height so a recycled cell can shrink to its content after
 * a delete. Later `undefined` in a style array does not unset RN values.
 */
export function omitFlashListCellMinHeight<T extends FlashListCellLayoutStyle>(
  style: T,
): Omit<T, "minHeight" | "maxHeight"> {
  const { minHeight: _minHeight, maxHeight: _maxHeight, ...rest } = style;
  return rest;
}
