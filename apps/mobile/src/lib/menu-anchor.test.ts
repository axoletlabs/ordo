import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipSelectionAnchor,
  estimateSelectionAnchor,
  placeMenu,
  resolveSelectionAnchor,
  SELECTION_MENU_STRIP,
  thinSelectionAnchor,
  type MenuAnchorRect,
} from "./menu-anchor.ts";

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

function anchor(x: number, y: number, width = 40, height = 40): MenuAnchorRect {
  return { x, y, width, height };
}

test("places below a trigger when the list still has room", () => {
  const placed = placeMenu({
    anchor: anchor(700, 80),
    menuWidth: 252,
    menuHeight: 280,
    windowWidth: 800,
    windowHeight: 900,
    insets,
  });
  assert.equal(placed.placement, "below");
  assert.equal(placed.top, 80 + 40 + 6);
  assert.equal(placed.left, 700 + 40 - 252);
});

test("flips above when a lower bookmark would overflow the window", () => {
  const placed = placeMenu({
    anchor: anchor(700, 820),
    menuWidth: 252,
    menuHeight: 280,
    windowWidth: 800,
    windowHeight: 900,
    insets,
  });
  assert.equal(placed.placement, "above");
  assert.equal(placed.top, 820 - 6 - 280);
});

test("keeps the menu on-screen when the trigger sits on the right edge", () => {
  const placed = placeMenu({
    anchor: anchor(760, 120),
    menuWidth: 252,
    menuHeight: 200,
    windowWidth: 800,
    windowHeight: 900,
    insets,
  });
  assert.equal(placed.left, 800 - 12 - 252);
});

test("does not slide past the left padding on a narrow window", () => {
  const placed = placeMenu({
    anchor: anchor(8, 120, 32, 32),
    menuWidth: 252,
    menuHeight: 200,
    windowWidth: 320,
    windowHeight: 700,
    insets,
  });
  assert.equal(placed.left, 12);
});

test("respects safe-area insets when flipping above a bottom-row bookmark", () => {
  const placed = placeMenu({
    anchor: anchor(300, 740),
    menuWidth: 252,
    menuHeight: 300,
    windowWidth: 400,
    windowHeight: 800,
    insets: { top: 48, right: 0, bottom: 34, left: 0 },
  });
  assert.equal(placed.placement, "above");
  assert.ok(placed.top >= 48 + 12);
  assert.ok(placed.top + 300 <= 800 - 34 - 12 + 0.5);
});

test("keeps an above placement when a shorter confirm would now fit below", () => {
  const opts = {
    anchor: anchor(320, 520, 40, 72),
    menuWidth: 252,
    windowWidth: 390,
    windowHeight: 844,
    insets: { top: 47, right: 0, bottom: 34, left: 0 },
  };
  const full = placeMenu({ ...opts, menuHeight: 360 });
  assert.equal(full.placement, "above");
  const confirm = placeMenu({ ...opts, menuHeight: 150, preferredPlacement: full.placement });
  assert.equal(confirm.placement, "above");
  assert.equal(confirm.top, 520 - 6 - 150);
});

test("abandons a preferred side that no longer fits", () => {
  const placed = placeMenu({
    anchor: anchor(700, 820),
    menuWidth: 252,
    menuHeight: 280,
    windowWidth: 800,
    windowHeight: 900,
    insets,
    preferredPlacement: "below",
  });
  assert.equal(placed.placement, "above");
  assert.equal(placed.top, 820 - 6 - 280);
});

test("clamps onto the window when the trigger is reported below it", () => {
  const placed = placeMenu({
    anchor: anchor(40, 2400),
    menuWidth: 252,
    menuHeight: 160,
    windowWidth: 390,
    windowHeight: 844,
    insets,
  });
  assert.ok(placed.top >= 12);
  assert.ok(placed.top + 160 <= 844 - 12 + 0.5);
});

test("estimateSelectionAnchor sits on the selected line of a tall paragraph", () => {
  const host = { x: 20, y: 80, width: 300, height: 800 };
  const placed = estimateSelectionAnchor(host, 25, 40, 100);
  assert.equal(placed.y, 80 + 800 * 0.25);
  assert.equal(placed.height, SELECTION_MENU_STRIP);
  assert.notEqual(placed.y, 80 + 400);
});

test("thinSelectionAnchor keeps a one-line native rect and trims a block", () => {
  const line = { x: 10, y: 200, width: 120, height: 22 };
  assert.equal(thinSelectionAnchor(line), line);
  const block = { x: 10, y: 200, width: 120, height: 400 };
  assert.deepEqual(thinSelectionAnchor(block), { ...block, height: SELECTION_MENU_STRIP });
});

test("clipSelectionAnchor pulls an off-screen strip back into the window", () => {
  const clipped = clipSelectionAnchor(
    { x: 16, y: 2000, width: 200, height: 32 },
    { width: 390, height: 844 },
  );
  assert.equal(clipped, null);
  const top = clipSelectionAnchor(
    { x: 16, y: -10, width: 200, height: 50 },
    { width: 390, height: 844 },
  );
  assert.deepEqual(top, { x: 16, y: 0, width: 200, height: SELECTION_MENU_STRIP });
});

test("resolveSelectionAnchor prefers a native rect over the paragraph host", () => {
  const placed = resolveSelectionAnchor({
    nativeRect: { x: 40, y: 120, width: 80, height: 24 },
    host: { x: 16, y: 0, width: 360, height: 2000 },
    start: 0,
    end: 4,
    textLength: 400,
    viewport: { width: 390, height: 844 },
  });
  assert.deepEqual(placed, { x: 40, y: 120, width: 80, height: 24 });
});

test("pixel-sized native rects from a lower paragraph are scaled into the window", () => {
  const placed = resolveSelectionAnchor({
    nativeRect: { x: 120, y: 1800, width: 240, height: 96 },
    host: { x: 16, y: 400, width: 360, height: 120 },
    start: 10,
    end: 40,
    textLength: 80,
    viewport: { width: 390, height: 844 },
    density: 3,
  });
  assert.equal(placed?.x, 40);
  assert.equal(placed?.y, 600);
  assert.equal(placed?.width, 80);
});
