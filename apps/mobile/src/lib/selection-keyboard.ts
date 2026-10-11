/** Roving selection for one-dimensional controls and fixed-column grids. */
export function selectionIndex(key: string, index: number, length: number, columns = 1): number | null {
  if (!length) return null;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1
    : key === "ArrowDown" ? columns : key === "ArrowUp" ? -columns : 0;
  return step ? (index + step + length) % length : null;
}
