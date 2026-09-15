import assert from "node:assert/strict";
import { test } from "node:test";
import { omitFlashListCellMinHeight, shouldClearFlashListLayout } from "./flash-list-layout.ts";

test("clears layout only when the list shrinks", () => {
  assert.equal(shouldClearFlashListLayout(null, 37), false);
  assert.equal(shouldClearFlashListLayout(0, 10), false);
  assert.equal(shouldClearFlashListLayout(37, 37), false);
  assert.equal(shouldClearFlashListLayout(37, 38), false);
  assert.equal(shouldClearFlashListLayout(37, 36), true);
  assert.equal(shouldClearFlashListLayout(1, 0), true);
});

test("drops leftover minHeight so a recycled cell can shrink", () => {
  const next = omitFlashListCellMinHeight({
    position: "absolute",
    top: 144,
    width: 360,
    minHeight: 200,
    maxHeight: 400,
  });
  assert.equal("minHeight" in next, false);
  assert.equal("maxHeight" in next, false);
  assert.equal(next.top, 144);
  assert.equal(next.width, 360);
});
