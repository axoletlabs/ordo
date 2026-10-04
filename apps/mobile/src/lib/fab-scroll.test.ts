import assert from "node:assert/strict";
import { test } from "node:test";
import { createFabScrollState } from "./fab-scroll.ts";

test("FAB collapses down and expands up after meaningful movement", () => {
  const state = createFabScrollState();
  assert.equal(state(10), false);
  assert.equal(state(30), true);
  assert.equal(state(100), true);
  assert.equal(state(90), true);
  assert.equal(state(70), false);
});
test("small jitter cannot toggle the FAB and returning to the top expands it", () => {
  const state = createFabScrollState();
  assert.equal(state(100), true);
  for (const offset of [99, 101, 100, 102]) assert.equal(state(offset), true);
  assert.equal(state(0), false);
  assert.equal(state(-20), false);
});
