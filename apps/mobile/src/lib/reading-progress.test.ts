import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollReadingProgress, shouldFlushReadingProgress } from "./reading-progress.ts";

test("short content that fits the viewport is complete", () => {
  assert.equal(scrollReadingProgress(0, 800, 500), 1);
});

test("progress is zero at the top of a long article", () => {
  assert.equal(scrollReadingProgress(0, 800, 2800), 0);
});

test("progress follows scroll in both directions", () => {
  assert.equal(scrollReadingProgress(500, 800, 1800), 0.5);
  assert.equal(scrollReadingProgress(250, 800, 1800), 0.25);
  assert.equal(scrollReadingProgress(1000, 800, 1800), 1);
});

test("unknown layout reports no progress", () => {
  assert.equal(scrollReadingProgress(100, 0, 2000), 0);
  assert.equal(scrollReadingProgress(100, 800, 0), 0);
});

test("progress flushes when the bar moves far enough either way", () => {
  assert.equal(shouldFlushReadingProgress(0.5, null, 0.08, 0.98), true);
  assert.equal(shouldFlushReadingProgress(0.5, 0.4, 0.08, 0.98), true);
  assert.equal(shouldFlushReadingProgress(0.2, 0.4, 0.08, 0.98), true);
  assert.equal(shouldFlushReadingProgress(0.42, 0.4, 0.08, 0.98), false);
  assert.equal(shouldFlushReadingProgress(0.99, 0.4, 0.08, 0.98), true);
});
