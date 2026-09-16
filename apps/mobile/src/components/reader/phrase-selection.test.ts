import assert from "node:assert/strict";
import { test } from "node:test";
import { selectedRange } from "./phrase-selection.ts";

test("selectedRange ignores a caret", () => {
  assert.equal(selectedRange(4, 4), null);
  assert.equal(selectedRange(0, 0), null);
});

test("selectedRange normalizes a highlight span", () => {
  assert.deepEqual(selectedRange(2, 8), { start: 2, end: 8 });
  assert.deepEqual(selectedRange(8, 2), { start: 2, end: 8 });
});
