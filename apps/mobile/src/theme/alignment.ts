/**
 * One set of edges for the whole app.
 *
 * Screen rail — section labels, card edges, list hairlines, header text
 * actions, and the back chevron's tip. Pad a centered column with
 * `columnContentInset`. A cutout replaces the rail only where the column
 * does not already clear it. Never add the safe area on top of the rail;
 * that is how the header and the body drift apart.
 *
 * Title line — the back button and trailing header icons center on the
 * title. A subtitle hangs below and must not move them, so the arrow sits
 * on the same line on every screen.
 *
 * Row inset — `layout.rowInset`, the leading icon inside a list row or a
 * settings card. It is measured from the container edge. It is not the
 * same x as the back chevron; the chevron is page chrome on the rail.
 *
 * Ordinary header icons stay centered in one shared hit target whose outer
 * edge is the rail. The back chevron is the exception: it points at the
 * edge, so its visible tip is shifted onto the rail.
 *
 * Forms (auth) keep their own interior padding and add the safe area,
 * because that padding is not the screen rail. Menu rows pad inside the
 * panel, not against the screen.
 *
 * `layout.screenHorizontalPad` and `layout.rowInset` are these constants.
 */

/** Page edge. Section labels, cards, list hairlines, header actions. */
export const SCREEN_RAIL = 16;
/** Leading icon inside a list row or settings card, from that container's edge. */
export const ROW_INSET = 16;

/**
 * Horizontal padding for a column of at most `columnMax` centered in
 * `windowWidth`.
 */
export function columnContentInset(safeArea: number, windowWidth: number, columnMax: number): number {
  const sideMargin = Math.max(0, (windowWidth - columnMax) / 2);
  const uncovered = Math.max(0, safeArea - sideMargin);
  return Math.max(uncovered, SCREEN_RAIL);
}

/** Full-bleed rail, when there is no centered column. */
export function contentInset(safeArea: number): number {
  return Math.max(safeArea, SCREEN_RAIL);
}

/**
 * Ionicons `chevron-back` drawn at this size. The tip inset below was
 * measured from that glyph's ink, not its em-square. Re-measure if the
 * size changes.
 */
export const CHEVRON_BACK_ICON_SIZE = 24;
/** Pixels of empty em-square to the left of the chevron tip at {@link CHEVRON_BACK_ICON_SIZE}. */
export const CHEVRON_BACK_TIP_INSET = 7;

/**
 * translateX that puts the chevron tip on the leading edge of a hit target
 * of `controlSize`, when the icon is centered in that target.
 */
export function chevronBackTipShift(controlSize: number): number {
  return -((controlSize - CHEVRON_BACK_ICON_SIZE) / 2 + CHEVRON_BACK_TIP_INSET);
}
