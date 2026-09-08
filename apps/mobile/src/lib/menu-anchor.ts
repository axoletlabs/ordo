/**
 * Window-space placement for floating context menus. Aligns to the trailing
 * edge of a trigger (the row "more" button, a header icon, the FAB) and flips
 * above when a long bookmark list leaves no room below.
 */

export interface MenuAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MenuInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
  placement: "above" | "below";
  maxHeight: number;
}

export const CONTEXT_MENU_WIDTH = 252;
export const CONTEXT_MENU_GAP = 6;
export const CONTEXT_MENU_EDGE = 12;

export function menuHoverFill(mode: "light" | "dark", strong = false): string {
  if (mode === "dark") return strong ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)";
  return strong ? "rgba(21,20,15,0.08)" : "rgba(21,20,15,0.05)";
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

export function isMenuAnchorRect(value: MenuAnchorRect | null | undefined): value is MenuAnchorRect {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.width) && value.width >= 1 && value.height >= 1;
}

type MeasureNode = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

type PointEvent = { nativeEvent: { pageX: number; pageY: number } };

function rectFromPoint(event: PointEvent): MenuAnchorRect {
  return {
    x: event.nativeEvent.pageX,
    y: event.nativeEvent.pageY,
    width: 1,
    height: 1,
  };
}

/** Read a trigger's window rect, falling back to the press point if measure fails. */
export function measureAnchor(
  node: MeasureNode | null | undefined,
  onMeasured: (anchor: MenuAnchorRect) => void,
  event?: PointEvent | null,
): void {
  const finish = (anchor: MenuAnchorRect | null) => {
    if (anchor) {
      onMeasured(anchor);
      return;
    }
    if (event) onMeasured(rectFromPoint(event));
  };

  if (!node || typeof node.measureInWindow !== "function") {
    finish(null);
    return;
  }

  node.measureInWindow((x, y, width, height) => {
    if (isMenuAnchorRect({ x, y, width, height })) {
      finish({ x, y, width, height });
      return;
    }
    finish(null);
  });
}

export function placeMenu({
  anchor,
  menuWidth,
  menuHeight,
  windowWidth,
  windowHeight,
  insets = { top: 0, right: 0, bottom: 0, left: 0 },
  gap = CONTEXT_MENU_GAP,
  padding = CONTEXT_MENU_EDGE,
}: {
  anchor: MenuAnchorRect;
  menuWidth: number;
  menuHeight: number;
  windowWidth: number;
  windowHeight: number;
  insets?: MenuInsets;
  gap?: number;
  padding?: number;
}): MenuPlacement {
  const maxHeight = Math.max(0, windowHeight - insets.top - insets.bottom - padding * 2);
  const height = Math.min(Math.max(menuHeight, 0), maxHeight);

  const leftMin = insets.left + padding;
  const leftMax = windowWidth - insets.right - padding - menuWidth;
  const alignedLeft = anchor.x + anchor.width - menuWidth;
  const left = clamp(alignedLeft, leftMin, leftMax);

  const topMin = insets.top + padding;
  const topMax = windowHeight - insets.bottom - padding - height;
  const belowTop = anchor.y + anchor.height + gap;
  const aboveTop = anchor.y - gap - height;
  const fitsBelow = belowTop <= topMax + 0.5;
  const fitsAbove = aboveTop >= topMin - 0.5;

  if (fitsBelow) {
    return { left, top: belowTop, placement: "below", maxHeight };
  }
  if (fitsAbove) {
    return { left, top: aboveTop, placement: "above", maxHeight };
  }

  const spaceBelow = windowHeight - insets.bottom - padding - (anchor.y + anchor.height + gap);
  const spaceAbove = anchor.y - gap - (insets.top + padding);
  if (spaceBelow >= spaceAbove) {
    return { left, top: clamp(belowTop, topMin, Math.max(topMin, topMax)), placement: "below", maxHeight };
  }
  return { left, top: clamp(aboveTop, topMin, Math.max(topMin, topMax)), placement: "above", maxHeight };
}
