import assert from "node:assert/strict";
import { test } from "node:test";
import {
  estimateMenuHeight,
  measureAnchor,
  placeContextMenu,
  CONTEXT_MENU_ITEM_HEIGHT,
  CONTEXT_MENU_PADDING_Y,
} from "./context-menu-layout.ts";

const WINDOW = { windowWidth: 390, windowHeight: 844 };
const MENU = { menuWidth: 244, menuHeight: 320 };
const INSETS = { top: 47, right: 0, bottom: 34, left: 0 };

function moreButton(y: number) {
  return { x: 334, y, width: 40, height: 40 };
}

test("estimateMenuHeight includes vertical padding", () => {
  assert.equal(estimateMenuHeight(6), 6 * CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_PADDING_Y * 2);
});

test("a middle bookmark opens the menu below, hanging left from the more button", () => {
  const anchor = moreButton(360);
  const placed = placeContextMenu({ ...WINDOW, ...MENU, anchor, insets: INSETS, align: "end" });
  assert.equal(placed.left, anchor.x + anchor.width - MENU.menuWidth);
  assert.equal(placed.top, anchor.y + anchor.height + 6);
});

test("two bookmarks at different rows get different menu tops", () => {
  const first = placeContextMenu({ ...WINDOW, ...MENU, anchor: moreButton(140), insets: INSETS });
  const second = placeContextMenu({ ...WINDOW, ...MENU, anchor: moreButton(420), insets: INSETS });
  assert.ok(second.top > first.top);
  assert.equal(first.left, second.left);
});

test("a bookmark near the bottom flips the menu above the trigger", () => {
  const anchor = moreButton(760);
  const placed = placeContextMenu({ ...WINDOW, ...MENU, anchor, insets: INSETS });
  assert.ok(placed.top + MENU.menuHeight <= anchor.y);
  assert.ok(placed.top >= INSETS.top + 8);
});

test("a bookmark near the top keeps the menu below the trigger", () => {
  const anchor = moreButton(56);
  const placed = placeContextMenu({ ...WINDOW, ...MENU, anchor, insets: INSETS });
  assert.ok(placed.top >= anchor.y + anchor.height);
});

test("a menu that would overflow the left edge is clamped on-screen", () => {
  const placed = placeContextMenu({
    ...WINDOW,
    menuWidth: 244,
    menuHeight: 200,
    anchor: { x: 4, y: 200, width: 40, height: 40 },
    insets: INSETS,
    align: "end",
  });
  assert.equal(placed.left, INSETS.left + 8);
});

test("center alignment sits the menu under an avatar", () => {
  const anchor = { x: 159, y: 120, width: 72, height: 72 };
  const placed = placeContextMenu({
    ...WINDOW,
    menuWidth: 244,
    menuHeight: 140,
    anchor,
    insets: INSETS,
    align: "center",
  });
  assert.equal(placed.left, anchor.x + anchor.width / 2 - 244 / 2);
  assert.ok(placed.top >= anchor.y + anchor.height);
});

test("a FAB in the lower-right opens the menu above it", () => {
  const anchor = { x: 322, y: 760, width: 48, height: 48 };
  const placed = placeContextMenu({ ...WINDOW, ...MENU, menuHeight: 108, anchor, insets: INSETS });
  assert.ok(placed.top + 108 <= anchor.y);
  assert.equal(placed.left, anchor.x + anchor.width - MENU.menuWidth);
});

test("measureAnchor uses the view rect when it is valid", () => {
  const node = {
    measureInWindow(cb: (x: number, y: number, width: number, height: number) => void) {
      cb(10, 20, 40, 40);
    },
  };
  let result = { x: 0, y: 0, width: 0, height: 0 };
  measureAnchor(node, (anchor) => {
    result = anchor;
  });
  assert.deepEqual(result, { x: 10, y: 20, width: 40, height: 40 });
});

test("measureAnchor falls back to the press point when measure fails", () => {
  const node = {
    measureInWindow(cb: (x: number, y: number, width: number, height: number) => void) {
      cb(0, 0, 0, 0);
    },
  };
  let result = { x: 0, y: 0, width: 0, height: 0 };
  measureAnchor(
    node,
    (anchor) => {
      result = anchor;
    },
    { nativeEvent: { pageX: 300, pageY: 180 } },
  );
  assert.deepEqual(result, { x: 300, y: 180, width: 1, height: 1 });
});
