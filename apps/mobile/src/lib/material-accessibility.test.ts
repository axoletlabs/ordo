import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionIndex } from "./selection-keyboard.ts";
import { parseTimeInput } from "./time-input.ts";
import { appendPatternNode } from "./pattern-input.ts";
import { progressFraction } from "./progress-fraction.ts";

test("radio navigation wraps, respects grid rows and supports Home/End", () => {
  assert.equal(selectionIndex("ArrowRight", 8, 9, 3), 0);
  assert.equal(selectionIndex("ArrowLeft", 0, 9, 3), 8);
  assert.equal(selectionIndex("ArrowDown", 1, 9, 3), 4);
  assert.equal(selectionIndex("ArrowUp", 1, 9, 3), 7);
  assert.equal(selectionIndex("Home", 5, 9), 0);
  assert.equal(selectionIndex("End", 5, 9), 8);
  assert.equal(selectionIndex("Enter", 5, 9), null);
  assert.equal(selectionIndex("ArrowRight", 0, 0), null);
});
test("time entry accepts every minute and converts midnight/noon correctly", () => {
  assert.deepEqual(parseTimeInput("12", "07", true, "am"), { hour: 0, minute: 7 });
  assert.deepEqual(parseTimeInput("12", "59", true, "pm"), { hour: 12, minute: 59 });
  assert.deepEqual(parseTimeInput("1", "1", true, "pm"), { hour: 13, minute: 1 });
  assert.deepEqual(parseTimeInput("23", "59", false, "am"), { hour: 23, minute: 59 });
  assert.deepEqual(parseTimeInput("00", "00", false, "am"), { hour: 0, minute: 0 });
});
test("invalid time drafts cannot become valid reminder times", () => {
  for (const [h, m, hour12] of [["", "00", true], ["0", "0", true], ["13", "0", true], ["24", "00", false], ["12", "60", true], ["-1", "0", false], ["1.2", "0", true], ["1", "", true]] as const)
    assert.equal(parseTimeInput(h, m, hour12, "am"), null);
});
test("accessible pattern entry preserves the existing Android skip-fill credential", () => {
  assert.deepEqual(appendPatternNode([0], 2), [0, 1, 2]);
  assert.deepEqual(appendPatternNode([0], 8), [0, 4, 8]);
  assert.deepEqual(appendPatternNode([2], 6), [2, 4, 6]);
  assert.deepEqual(appendPatternNode([0, 4, 2], 6), [0, 4, 2, 6]);
  assert.deepEqual(appendPatternNode([0, 1], 0), [0, 1]);
  assert.deepEqual(appendPatternNode([0], 9), [0]);
  const original = [0]; appendPatternNode(original, 8); assert.deepEqual(original, [0]);
});
test("determinate processing progress reports zero accurately and clamps invalid values", () => {
  for (const [input, output] of [[0, 0], [0.01, 0.01], [0.75, 0.75], [-1, 0], [2, 1], [NaN, 0], [Infinity, 0]])
    assert.equal(progressFraction(input), output);
});
