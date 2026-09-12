/**
 * Theme-aware scrollbar colors and thumb geometry.
 *
 * Native Android/iOS indicators inherit the activity's Light theme, so they
 * stay dark in Dark/AMOLED (invisible on black) and look like an OS chrome
 * overlay on parchment. These tokens drive the in-app overlay, web CSS, and
 * Android drawables instead.
 */
import type { Palette } from "./theme";

/** Hairline-adjacent so it reads as a divider, not OS chrome. */
export const SCROLLBAR_THUMB_WIDTH = 2;
/**
 * Library lists sit in ScreenContent's 16px pad. A small negative right
 * parks the mark in that gutter — flush with the row hairline's ending and
 * just past the FAB, which is 20px off the same edge.
 */
export const SCROLLBAR_EDGE_INSET = -8;
export const SCROLLBAR_END_INSET = 12;
export const SCROLLBAR_MIN_THUMB = 28;
export const SCROLLBAR_IDLE_MS = 1100;

export type ScrollBarInsets = {
  top?: number;
  bottom?: number;
};

/**
 * Bottom inset for the overlay thumb. `chromeClearance` is the floating dock
 * / selection bar / home-indicator band — the same pad that keeps the last
 * bookmark above the nav.
 */
export function scrollBarBottomInset(chromeClearance: number): number {
  return Math.max(SCROLLBAR_END_INSET, chromeClearance);
}

/**
 * How much of a list viewport is covered by overlay chrome.
 *
 * Window-absolute toasts use a different number: they must also clear a
 * docked tab bar. The overlay scrollbar lives in the scene, which that bar
 * already shrinks.
 */
export function listScrollOverlayClearance(args: {
  hideBottomNav: boolean;
  selectionClearance: number;
  floatingDockVisible: boolean;
  floatingDockClearance: number;
  dockedTabScene: boolean;
  safeBottomClearance: number;
}): number {
  if (args.hideBottomNav) return args.selectionClearance;
  if (args.floatingDockVisible) return args.floatingDockClearance;
  if (args.dockedTabScene) return 0;
  return args.safeBottomClearance;
}

/** `hex` (#RRGGBB) at `alpha` (0–1) as an rgba() string. */
export function inkAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function scrollbarColors(palette: Palette): { thumb: string; track: string } {
  // Track stays empty — a full-height rail is what made the last bar look like
  // a grafted-on OS widget. Thumb uses the same ink as hairline borders, a
  // little denser so a 2px mark still reads while scrolling.
  if (palette.amoled) {
    return { thumb: "rgba(224,224,224,0.38)", track: "transparent" };
  }
  if (palette.mode === "dark") {
    return { thumb: inkAlpha(palette.text, 0.28), track: "transparent" };
  }
  return { thumb: inkAlpha(palette.text, 0.26), track: "transparent" };
}

/**
 * Whether a themed ScrollView should `flex: 1` its inner scroller.
 *
 * `maxHeight` alone is not a definite size. Filling in that case puts a
 * flex child in a height-less wrapper, which collapses to 0 — the context
 * menu went invisible after the scrollbar wrap for this reason.
 */
export function scrollViewShouldFill(wrapper: {
  flex?: unknown;
  flexGrow?: unknown;
  height?: unknown;
  maxHeight?: unknown;
} | undefined): boolean {
  if (!wrapper) return false;
  return wrapper.flex != null || wrapper.flexGrow != null || wrapper.height != null;
}

export function scrollThumbLayout(
  viewport: number,
  content: number,
  offset: number,
  track: number,
  minThumb = SCROLLBAR_MIN_THUMB,
): { thumb: number; y: number } | null {
  if (content <= viewport + 1 || track <= 0) return null;
  const thumb = Math.min(track, Math.max(minThumb, (viewport / content) * track));
  const maxScroll = content - viewport;
  const travel = Math.max(0, track - thumb);
  const clamped = Math.min(maxScroll, Math.max(0, offset));
  const y = maxScroll <= 0 ? 0 : (clamped / maxScroll) * travel;
  return { thumb, y };
}

export const WEB_SCROLLBAR_CSS = `
* {
  scrollbar-width: thin;
  scrollbar-color: var(--ordo-scrollbar-thumb) transparent;
}
*::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
*::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background-color: var(--ordo-scrollbar-thumb);
  border-radius: 99px;
  border: 3px solid transparent;
  background-clip: content-box;
}
*::-webkit-scrollbar-corner {
  background: transparent;
}
`;
