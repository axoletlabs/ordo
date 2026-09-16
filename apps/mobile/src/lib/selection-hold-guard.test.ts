import assert from "node:assert/strict";
import { test } from "node:test";
import { createSelectionHoldGuard } from "./selection-hold-guard.ts";

function withQueue() {
  const queue: Array<() => void> = [];
  const guard = createSelectionHoldGuard((cb) => {
    queue.push(cb);
  });
  const flush = () => {
    const pending = queue.splice(0);
    for (const cb of pending) cb();
  };
  return { guard, flush };
}

test("the release after entering selection is ignored until the pointer is up", () => {
  const { guard, flush } = withQueue();
  guard.pressIn();
  guard.markEnter();
  assert.equal(guard.consumePress(), true);
  flush();
  assert.equal(guard.shouldIgnorePress(), false);
  assert.equal(guard.consumePress(), false);
});

test("a remounted pressable under the same finger does not lift the guard", () => {
  const { guard, flush } = withQueue();
  guard.pressIn();
  guard.markEnter();
  guard.pressOut();
  guard.pressIn();
  flush();
  assert.equal(guard.shouldIgnorePress(), true);
  assert.equal(guard.consumePress(), true);
  guard.pressOut();
  flush();
  assert.equal(guard.shouldIgnorePress(), false);
});

test("a later tap is not swallowed once the entering finger lifts", () => {
  const { guard, flush } = withQueue();
  guard.pressIn();
  guard.markEnter();
  guard.pressOut();
  flush();
  guard.pressIn();
  assert.equal(guard.consumePress(), false);
});

test("taps that never entered selection are not ignored", () => {
  const { guard } = withQueue();
  guard.pressIn();
  assert.equal(guard.consumePress(), false);
});

test("reset clears a leftover enter hold", () => {
  const { guard } = withQueue();
  guard.pressIn();
  guard.markEnter();
  guard.reset();
  assert.equal(guard.shouldIgnorePress(), false);
  assert.equal(guard.consumePress(), false);
});
