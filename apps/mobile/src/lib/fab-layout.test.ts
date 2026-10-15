import assert from "node:assert/strict";
import { test } from "node:test";
import { FAB_SIZE, fabBottomOffset, fabContentPadding } from "./fab-layout.ts";

test("a reader with no bottom safe area reserves the FAB plus a reading gap", () => {
  assert.equal(fabBottomOffset(0), 20);
  assert.equal(fabContentPadding(0), 92);
});

test("safe area is included once in the overlay and content clearance", () => {
  assert.equal(fabBottomOffset(34, 54), 54);
  assert.equal(fabContentPadding(34, 54), 126);
});

test("embedded readers respect the FAB's minimum safe-area offset", () => {
  assert.equal(fabBottomOffset(34, 20), 50);
  assert.equal(fabContentPadding(34, 20), 122);
});

test("custom offsets and list gaps use the same geometry", () => {
  assert.equal(fabBottomOffset(0, 80), 80);
  assert.equal(fabContentPadding(0, 80, 8), 144);
  assert.equal(fabContentPadding(0, undefined, 8), 84);
});

test("the final content stays 16dp above the button for every safe area and offset", () => {
  for (const safeArea of [0, 4, 16, 24, 34, 48]) {
    for (const bottom of [0, 20, 20 + safeArea, 80]) {
      assert.equal(fabContentPadding(safeArea, bottom) - fabBottomOffset(safeArea, bottom) - FAB_SIZE, 16);
    }
  }
});
