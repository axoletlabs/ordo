import assert from "node:assert/strict";
import { test } from "node:test";
import { beginRefreshPull, moveRefreshPull, finishRefreshPull } from "./pull-refresh.ts";

test("pull refresh commits only past the threshold and while idle at the top", () => {
  const pull = beginRefreshPull(10, 100, 0, true);
  assert.equal(finishRefreshPull(moveRefreshPull(pull, 10, 171, 0), false), false);
  const armed = moveRefreshPull(pull, 10, 172, 0);
  assert.equal(finishRefreshPull(armed, false), true);
  assert.equal(finishRefreshPull(armed, true), false);
  assert.equal(finishRefreshPull(beginRefreshPull(10, 100, 25, true), false), false);
  assert.equal(finishRefreshPull(beginRefreshPull(10, 100, 0, false), false), false);
});

test("horizontal, multi-touch, cancelled and scrolled gestures cannot refresh", () => {
  const pull = beginRefreshPull(10, 100, 0, true);
  for (const invalid of [moveRefreshPull(pull, 150, 200, 0), moveRefreshPull(pull, 10, 200, 0, 2), moveRefreshPull(pull, 10, 200, 20)]) {
    assert.equal(finishRefreshPull(invalid, false), false);
    assert.equal(finishRefreshPull(moveRefreshPull(invalid, 10, 300, 0), false), false);
  }
  assert.equal(finishRefreshPull(null, false), false);
});

test("dragging back below threshold disarms the pull", () => {
  const armed = moveRefreshPull(beginRefreshPull(10, 100, 0, true), 10, 200, 0);
  assert.equal(finishRefreshPull(moveRefreshPull(armed, 10, 120, 0), false), false);
});
