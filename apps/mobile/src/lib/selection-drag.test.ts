import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoScrollStep,
  indexAtPoint,
  indexForDrag,
  keysAfterDrag,
  sameSelection,
  shouldClaimSelectionDrag,
} from "./selection-drag.ts";

const keys = ["a", "b", "c", "d"];

test("drag selects the inclusive range and leaves the baseline outside it", () => {
  const next = keysAfterDrag(keys, new Set(["d"]), "b", 0, "select");
  assert.deepEqual(next?.slice().sort(), ["a", "b", "d"]);
});

test("dragging back shrinks the range to the baseline", () => {
  const next = keysAfterDrag(keys, new Set(["a"]), "a", 1, "select");
  assert.deepEqual(next, ["a", "b"]);
  const back = keysAfterDrag(keys, new Set(["a"]), "a", 0, "select");
  assert.deepEqual(back, ["a"]);
});

test("deselect drag clears the range and keeps the rest", () => {
  const next = keysAfterDrag(keys, new Set(["a", "b", "d"]), "b", 3, "deselect");
  assert.deepEqual(next, ["a"]);
});

test("indexAtPoint prefers the row containing the pointer", () => {
  const frames = new Map([
    ["a", { top: 0, bottom: 40 }],
    ["c", { top: 80, bottom: 120 }],
  ]);
  assert.equal(indexAtPoint(keys, frames, 10), 0);
  assert.equal(indexAtPoint(keys, frames, 100), 2);
  assert.equal(indexAtPoint(keys, frames, 60), null);
});

test("indexForDrag snaps a hairline gap and ignores a real one", () => {
  const frames = new Map([
    ["a", { top: 0, bottom: 40 }],
    ["b", { top: 48, bottom: 80 }],
    ["c", { top: 160, bottom: 200 }],
  ]);
  assert.equal(indexForDrag(keys, frames, 45), 1);
  assert.equal(indexForDrag(keys, frames, 100), null);
});

test("autoScrollStep points outward inside the edge bands only", () => {
  assert.equal(autoScrollStep(10, 0, 400), -25);
  assert.equal(autoScrollStep(200, 0, 400), 0);
  assert.equal(autoScrollStep(390, 0, 400), 25);
});

test("a flick is left to the list scroller", () => {
  assert.equal(shouldClaimSelectionDrag(0, 40, 20), false);
  assert.equal(shouldClaimSelectionDrag(2, 16, 80), true);
  assert.equal(shouldClaimSelectionDrag(30, 10, 80), false);
  assert.equal(shouldClaimSelectionDrag(0, 8, 80), false);
});

test("sameSelection ignores order", () => {
  assert.equal(sameSelection(new Set(["b", "a"]), ["a", "b"]), true);
  assert.equal(sameSelection(new Set(["a"]), ["a", "b"]), false);
});
