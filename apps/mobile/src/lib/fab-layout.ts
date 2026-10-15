/** Material FAB geometry shared by the overlay and its scrollable content. */
export const FAB_SIZE = 56;
export const FAB_DEFAULT_BOTTOM = 20;
const FAB_SAFE_AREA_GAP = 16;

export function fabBottomOffset(safeAreaBottom: number, bottom = FAB_DEFAULT_BOTTOM): number {
  return Math.max(bottom, safeAreaBottom + FAB_SAFE_AREA_GAP);
}

/** Trailing scroll space, not a fixed footer: the final item clears the FAB. */
export function fabContentPadding(safeAreaBottom: number, bottom = FAB_DEFAULT_BOTTOM, gap = 16): number {
  return fabBottomOffset(safeAreaBottom, bottom) + FAB_SIZE + gap;
}
