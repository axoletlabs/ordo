/**
 * Placement for floating context menus. Coordinates are window-relative
 * (the same space `measureInWindow` and a full-screen Modal share).
 */

export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type MenuAlign = "start" | "center" | "end";

export const CONTEXT_MENU_ITEM_HEIGHT = 44;
export const CONTEXT_MENU_PADDING_Y = 6;
export const CONTEXT_MENU_MIN_WIDTH = 228;
export const CONTEXT_MENU_MAX_WIDTH = 280;
export const CONTEXT_MENU_GAP = 6;
export const CONTEXT_MENU_SCREEN_PAD = 8;

export function estimateMenuHeight(itemCount: number): number {
  return Math.max(CONTEXT_MENU_ITEM_HEIGHT, itemCount * CONTEXT_MENU_ITEM_HEIGHT) + CONTEXT_MENU_PADDING_Y * 2;
}

export interface MenuPlacementInput {
  anchor: MenuAnchor;
  menuWidth: number;
  menuHeight: number;
  windowWidth: number;
  windowHeight: number;
  padding?: number;
  gap?: number;
  insets?: EdgeInsets;
  /** Horizontal alignment of the menu against the trigger. Default `end`. */
  align?: MenuAlign;
}

export interface MenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Keep the menu on-screen and next to the trigger that opened it. */
export function placeContextMenu(input: MenuPlacementInput): MenuPlacement {
  const padding = input.padding ?? CONTEXT_MENU_SCREEN_PAD;
  const gap = input.gap ?? CONTEXT_MENU_GAP;
  const insets = input.insets ?? ZERO_INSETS;
  const align = input.align ?? "end";
  const { anchor, menuWidth, menuHeight, windowWidth, windowHeight } = input;

  const minLeft = insets.left + padding;
  const maxLeft = windowWidth - insets.right - padding - menuWidth;
  const minTop = insets.top + padding;
  const usableHeight = windowHeight - insets.top - insets.bottom - padding * 2;
  const maxHeight = Math.max(CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_PADDING_Y * 2, usableHeight);
  const height = Math.min(menuHeight, maxHeight);
  const maxTop = windowHeight - insets.bottom - padding - height;

  let left: number;
  if (align === "start") left = anchor.x;
  else if (align === "center") left = anchor.x + anchor.width / 2 - menuWidth / 2;
  else left = anchor.x + anchor.width - menuWidth;

  if (maxLeft < minLeft) left = minLeft;
  else left = Math.min(Math.max(left, minLeft), maxLeft);

  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - height - gap;
  const spaceBelow = windowHeight - insets.bottom - padding - (anchor.y + anchor.height);
  const spaceAbove = anchor.y - insets.top - padding;

  let top: number;
  if (spaceBelow >= height + gap) top = below;
  else if (spaceAbove >= height + gap) top = above;
  else top = spaceBelow >= spaceAbove ? below : above;

  if (maxTop < minTop) top = minTop;
  else top = Math.min(Math.max(top, minTop), maxTop);

  return { left, top, maxHeight };
}

export type MeasureNode = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

export type PointEvent = { nativeEvent: { pageX: number; pageY: number } };

function fallbackAnchor(fallback?: MenuAnchor | PointEvent | null): MenuAnchor | null {
  if (!fallback) return null;
  if ("nativeEvent" in fallback) {
    return {
      x: fallback.nativeEvent.pageX,
      y: fallback.nativeEvent.pageY,
      width: 1,
      height: 1,
    };
  }
  return fallback;
}

/** Read a trigger's window rect, falling back to the press point if measure fails. */
export function measureAnchor(
  node: MeasureNode | null | undefined,
  onMeasured: (anchor: MenuAnchor) => void,
  fallback?: MenuAnchor | PointEvent | null,
): void {
  const finish = (anchor: MenuAnchor | null) => {
    const next = anchor ?? fallbackAnchor(fallback);
    if (next) onMeasured(next);
  };

  if (!node || typeof node.measureInWindow !== "function") {
    finish(null);
    return;
  }

  node.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y)) {
      finish({ x, y, width, height });
      return;
    }
    finish(null);
  });
}
