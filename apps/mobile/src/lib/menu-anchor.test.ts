import assert from "node:assert/strict";
import { test } from "node:test";
import { placeMenu, type MenuAnchorRect } from "./menu-anchor.ts";

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
