/**
 * One set of edges for the whole app.
 *
 * Screen rail — list hairlines, header text actions, and the back
 * chevron's tip. Section labels sit one row inset in, on the icon well.
 * Pad a centered column with
 * `columnContentInset`. A cutout replaces the rail only where the column
 * does not already clear it. Never add the safe area on top of the rail;
 * that is how the header and the body drift apart.
 *
 * Title line — the back button and trailing header icons center on the
 * title. A subtitle hangs below and must not move them, so the arrow sits
 * on the same line on every screen.
 *
 * Row inset — `layout.rowInset`, the leading icon inside a list row,
 * measured from the row edge. Bookmark, folder, tag, and settings rows
 * share one well (`ROW_ICON_FRAME`) and a hairline. They sit on the page,
 * not in a card. The well is not the same x as the back chevron; the
 * chevron is page chrome on the rail.
 *
 * Ordinary header icons stay centered in one shared hit target whose outer
 * edge is the rail. The back chevron is the exception: it points at the
 * edge, so its visible tip is shifted onto the rail.
 *
 * Forms (auth) keep their own interior padding and add the safe area,
 * because that padding is not the screen rail. Menu rows pad inside the
 * panel, not against the screen.
 *
 * First line — a mark beside wrapping copy (checkbox, list bullet) locks
 * to the first line of that copy. It uses the line box, not a taller icon,
 * and it does not center on the whole paragraph.
 *
 * Landscape — the side rail takes a strip of the window. Measure the
 * scene beside that rail (`sceneLeadingChrome`), and treat the leading
 * cutout as already cleared. A column nested inside that scene (the
 * embedded reader) uses the parent rail, not the window safe area.
 *
 * `layout.screenHorizontalPad` and `layout.rowInset` are these constants.
 */

/** Page edge. List hairlines and header actions. Section labels use the row inset. */
export const SCREEN_RAIL = 16;
/** Leading icon inside a list row, from that row's edge. */
export const ROW_INSET = 16;
/** Shared leading well for bookmark, folder, tag, and settings rows. */
export const ROW_ICON_FRAME = 36;
/** Glyph drawn inside {@link ROW_ICON_FRAME}. */
export const ROW_ICON_GLYPH = 18;

/**
 * Horizontal padding for a column of at most `columnMax` centered in
 * `sceneWidth`. Pass the navigation scene, not the window, once a side
 * rail has taken the leading strip.
 */
export function columnContentInset(safeArea: number, sceneWidth: number, columnMax: number): number {
  const sideMargin = Math.max(0, (sceneWidth - columnMax) / 2);
  const uncovered = Math.max(0, safeArea - sideMargin);
  return Math.max(uncovered, SCREEN_RAIL);
}

/** Minimum gap between a floating side rail and the screen edge. */
export const FLOATING_RAIL_EDGE = 8;
/** Gap between a floating side rail and the scene. */
export const FLOATING_RAIL_GAP = 12;

/**
 * Pixels the side rail takes from the leading edge of the window.
 * Docked rail width includes the leading cutout. Floating rail margin
 * matches `useRailSceneOffset`.
 */
export function sceneLeadingChrome(options: {
  sideNavigation: boolean;
  floating: boolean;
  railWidth: number;
  safeLeading: number;
}): number {
  if (!options.sideNavigation) return 0;
  if (!options.floating) return options.railWidth + options.safeLeading;
  return Math.max(options.safeLeading, FLOATING_RAIL_EDGE) + options.railWidth + FLOATING_RAIL_GAP;
}

/**
 * Safe-area insets the scene still has to clear. A side rail already
 * covers the leading cutout.
 */
export function sceneEdgeInsets(
  sideNavigation: boolean,
  safeLeading: number,
  safeTrailing: number,
): { leading: number; trailing: number } {
  return {
    leading: sideNavigation ? 0 : safeLeading,
    trailing: safeTrailing,
  };
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
