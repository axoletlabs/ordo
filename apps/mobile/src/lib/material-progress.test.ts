import assert from "node:assert/strict";
import { test } from "node:test";
import { circularIndeterminateArc, linearIndeterminateSegments, boundedProgress } from "./material-progress.ts";

test("progress geometry clamps invalid or out-of-range values", () => {
  assert.equal(boundedProgress(NaN), 0);
  assert.equal(boundedProgress(Infinity), 0);
  assert.equal(boundedProgress(-1), 0);
  assert.equal(boundedProgress(2), 1);
});

test("quick lines grow and shrink, stay bounded, and leave no visible loop seam", () => {
  for (let frame = 0; frame <= 1800; frame++) {
    for (const { start, end } of linearIndeterminateSegments(frame / 1800)) {
      assert.ok(start >= 0 && end <= 1 && start <= end, `frame ${frame}`);
    }
  }
  for (const phase of [0, 1]) {
    for (const { start, end } of linearIndeterminateSegments(phase)) assert.equal(start, end);
  }
  assert.ok(linearIndeterminateSegments(0.65)[1].end > 0, "second chase line is visible");
});

test("circular arc expands/contracts continuously and closes at four full turns", () => {
  let previous = circularIndeterminateArc(0);
  let maxSweep = 0;
  for (let frame = 1; frame <= 5400; frame++) {
    const arc = circularIndeterminateArc(frame / 5400);
    assert.ok(arc.start >= previous.start, "the tail never jumps backwards");
    assert.ok(Math.abs(arc.start - previous.start) < 1, "no visible jump at cycle boundaries");
    assert.ok(arc.sweep >= 24 && arc.sweep <= 276);
    maxSweep = Math.max(maxSweep, arc.sweep);
    previous = arc;
  }
  assert.equal(maxSweep, 276);
  assert.equal(previous.start % 360, 0);
  assert.equal(previous.sweep, circularIndeterminateArc(0).sweep);
});
