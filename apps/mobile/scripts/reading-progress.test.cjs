/** Run: node --test apps/mobile/scripts/reading-progress.test.cjs
 * Actual-source contract for the reader progress model. These cases describe
 * the viewport semantics the reader relies on: no completion before a ready,
 * measured article; short content only after a settle window; overscroll and
 * late layout changes clamped/recomputed; restore only for partial positions.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("../../../node_modules/typescript");

function load(filename) {
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = (name) => (name.startsWith(".") ? load(resolve(dirname(filename), name)) : require(name));
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

const reading = load(resolve(__dirname, "../src/lib/reading-progress.ts"));
const {
  measureReadingProgress,
  restoreReadingOffset,
  scrollReadingProgress,
  shouldFlushReadingProgress,
  reconcileReadingProgress,
  READING_EDGE_EPSILON,
  READING_RESTORE_MIN,
  READING_SHORT_SETTLE_MS,
} = reading;

const LONG = { viewportHeight: 800, contentHeight: 10000, ready: true, settled: false };
const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test("scrollReadingProgress clamps real offsets and never completes non-overflow", () => {
  close(scrollReadingProgress(0, 800, 10000), 0);
  close(scrollReadingProgress(4600, 800, 10000), 0.5);
  close(scrollReadingProgress(9200, 800, 10000), 1);
  close(scrollReadingProgress(-120, 800, 10000), 0);
  close(scrollReadingProgress(12000, 800, 10000), 1);
  close(scrollReadingProgress(4600, 800, 800), 0);
  close(scrollReadingProgress(4600, 800, 500), 0);
  assert.equal(scrollReadingProgress(NaN, 800, 10000), 0);
  assert.equal(scrollReadingProgress(10, Infinity, 10000), 0);
  assert.equal(scrollReadingProgress(10, 0, 10000), 0);
  assert.equal(scrollReadingProgress(10, 800, 0), 0);
});

test("an unready article is unmeasured even when the placeholder fits the viewport", () => {
  const result = measureReadingProgress({ ...LONG, ready: false, contentHeight: 600 });
  assert.equal(result.position, "unmeasured");
  assert.equal(result.measured, false);
  assert.equal(result.fraction, 0);
  assert.equal(result.canComplete, false);
});

test("zero/negative viewport and empty content report no progress", () => {
  for (const viewportHeight of [0, -1, NaN, Infinity]) {
    const result = measureReadingProgress({ ...LONG, viewportHeight });
    assert.equal(result.position, "unmeasured");
    assert.equal(result.fraction, 0);
    assert.equal(result.measured, false);
  }
  for (const contentHeight of [0, -5, NaN, Infinity]) {
    const result = measureReadingProgress({ ...LONG, contentHeight });
    assert.equal(result.position, "empty");
    assert.equal(result.fraction, 0);
    assert.equal(result.measured, false);
    assert.equal(result.canComplete, false);
  }
});

test("overflow positions, edge rounding, and overscroll clamp", () => {
  const top = measureReadingProgress({ ...LONG, offset: 0 });
  assert.deepEqual(
    { position: top.position, fraction: top.fraction, atTop: top.atTop, atBottom: top.atBottom, measured: top.measured, scrollable: top.scrollable },
    { position: "top", fraction: 0, atTop: true, atBottom: false, measured: true, scrollable: 9200 },
  );

  const mid = measureReadingProgress({ ...LONG, offset: 4600 });
  assert.equal(mid.position, "reading");
  close(mid.fraction, 0.5);
  assert.equal(mid.atTop, false);
  assert.equal(mid.atBottom, false);
  assert.equal(mid.canComplete, false);

  const bottom = measureReadingProgress({ ...LONG, offset: 9200 });
  assert.equal(bottom.position, "bottom");
  assert.equal(bottom.fraction, 1);
  assert.equal(bottom.canComplete, true);

  assert.equal(measureReadingProgress({ ...LONG, offset: -50 }).fraction, 0, "negative overscroll");
  assert.equal(measureReadingProgress({ ...LONG, offset: 999999 }).fraction, 1, "positive overscroll");
  assert.equal(measureReadingProgress({ ...LONG, offset: NaN }).position, "top", "invalid offsets read as top");

  const roundedTop = measureReadingProgress({ ...LONG, offset: READING_EDGE_EPSILON });
  assert.equal(roundedTop.position, "top", "rounding at 1px is still the top");
  assert.equal(roundedTop.fraction, 0);
  const roundedBottom = measureReadingProgress({ ...LONG, offset: 9200 - READING_EDGE_EPSILON });
  assert.equal(roundedBottom.position, "bottom", "rounding at the bottom is still the bottom");
  assert.equal(roundedBottom.fraction, 1);
});

test("sub-pixel overflow at offset zero stays at the top, not full", () => {
  const result = measureReadingProgress({ ...LONG, offset: 0, contentHeight: 800.5 });
  assert.equal(result.position, "top");
  assert.equal(result.fraction, 0);
  assert.equal(result.canComplete, false, "a half-pixel overflow cannot be completed from the top");
});

test("short content stays at zero until the settle window, then completes visually", () => {
  const pending = measureReadingProgress({ ...LONG, contentHeight: 700, settled: false });
  assert.equal(pending.position, "short");
  assert.equal(pending.short, true);
  assert.equal(pending.measured, true);
  assert.equal(pending.fraction, 0, "a viewport-sized placeholder must not paint 100%");
  assert.equal(pending.canComplete, false);

  const settled = measureReadingProgress({ ...LONG, contentHeight: 700, settled: true });
  assert.equal(settled.position, "short");
  assert.equal(settled.fraction, 1);
  assert.equal(settled.canComplete, true);
  assert.equal(settled.scrollable, 0);

  assert.equal(measureReadingProgress({ ...LONG, contentHeight: 800, settled: false }).fraction, 0);
  assert.equal(measureReadingProgress({ ...LONG, contentHeight: 800, settled: true }).fraction, 1);
  assert.ok(READING_SHORT_SETTLE_MS >= 250, "settle window is long enough for first layout");
});

test("late content growth lowers the same offset instead of leaving a full bar", () => {
  const offset = 5000;
  const before = measureReadingProgress({ ...LONG, offset, contentHeight: 10000 });
  const after = measureReadingProgress({ ...LONG, offset, contentHeight: 14000 });
  close(before.fraction, 5000 / 9200);
  close(after.fraction, 5000 / 13200);
  assert.ok(after.fraction < before.fraction, "an image/font growth moves the bar back");
  assert.equal(after.position, "reading");
});

test("viewport resize recomputes the fraction from the same offset immediately", () => {
  const portrait = measureReadingProgress({ ...LONG, offset: 1200, viewportHeight: 800, contentHeight: 10000 });
  const landscape = measureReadingProgress({ ...LONG, offset: 1200, viewportHeight: 2000, contentHeight: 10000 });
  close(portrait.fraction, 1200 / 9200);
  close(landscape.fraction, 1200 / 8000);
  assert.notEqual(portrait.fraction, landscape.fraction);
});

test("restore only targets partial saved positions with measured overflow", () => {
  const base = { viewportHeight: 800, contentHeight: 10000 };
  close(restoreReadingOffset(0.4, base.viewportHeight, base.contentHeight), 0.4 * 9200);
  assert.equal(restoreReadingOffset(0, base.viewportHeight, base.contentHeight), null);
  assert.equal(restoreReadingOffset(READING_RESTORE_MIN, base.viewportHeight, base.contentHeight), null,
    "effectively-top rows open at the top");
  assert.equal(restoreReadingOffset(0.98, base.viewportHeight, base.contentHeight), null,
    "completed rows intentionally open at the top");
  assert.equal(restoreReadingOffset(1, base.viewportHeight, base.contentHeight), null);
  assert.equal(restoreReadingOffset(0.4, 0, base.contentHeight), null);
  assert.equal(restoreReadingOffset(0.4, base.viewportHeight, 0), null);
  assert.equal(restoreReadingOffset(0.4, 800, 700), null, "a viewport-sized placeholder cannot restore");
  assert.equal(restoreReadingOffset(0.4, 800, 800), null);
  close(restoreReadingOffset(0.5, 800, 10000), 4600);
  close(restoreReadingOffset(0.97, 800, 10000), 0.97 * 9200, 1e-6);
});

test("restore and measure round-trip a partial fraction", () => {
  for (const target of [0.05, 0.2, 0.5, 0.79, 0.97]) {
    const y = restoreReadingOffset(target, 800, 10000);
    assert.notEqual(y, null, `target ${target} restores`);
    const readingBack = measureReadingProgress({ ...LONG, offset: y });
    close(readingBack.fraction, target, 1e-9);
  }
});

test("completion cannot be flushed before it is proven", () => {
  assert.equal(shouldFlushReadingProgress(1, 0.4, 0.08, 0.98), true, "legacy callers stay eligible");
  assert.equal(shouldFlushReadingProgress(1, 0.4, 0.08, 0.98, { completionEligible: false }), false,
    "a placeholder full sample never writes completion");
  assert.equal(shouldFlushReadingProgress(0.99, 0.4, 0.08, 0.98, { completionEligible: false }), false,
    "any value at/above the completion threshold needs proof");
  assert.equal(shouldFlushReadingProgress(0.97, 0.4, 0.08, 0.98, { completionEligible: false }), true,
    "a non-completion position can still persist normally");
  assert.equal(shouldFlushReadingProgress(1, 1, 0.08, 0.98), false, "already-completed rows are not rewritten");
  assert.equal(shouldFlushReadingProgress(null, 0, 0.08, 0.98), false, "invalid fractions never write");
  assert.equal(shouldFlushReadingProgress(NaN, 0, 0.08, 0.98), false);
});

test("flush deltas work in both directions and first writes are immediate", () => {
  assert.equal(shouldFlushReadingProgress(0.42, null, 0.08, 0.98), true);
  assert.equal(shouldFlushReadingProgress(0.42, 0.4, 0.08, 0.98), false);
  assert.equal(shouldFlushReadingProgress(0.5, 0.4, 0.08, 0.98), true);
  assert.equal(shouldFlushReadingProgress(0.2, 0.4, 0.08, 0.98), true, "scrolling up persists");
  assert.equal(shouldFlushReadingProgress(-0.2, null, 0.08, 0.98), true, "out-of-range first values clamp");
  assert.equal(shouldFlushReadingProgress(0, 0.1, 0.08, 0.98), true, "top can be saved when eligible");
});

test("reconcileReadingProgress keeps only progress fields and monotonic updatedAt", () => {
  const bookmark = {
    id: "b1", folderId: "f1", tags: ["old"], readProgress: 0.2, isRead: false,
    completedAt: null, updatedAt: "2026-10-20T12:00:00.000Z",
  };
  const updated = {
    ...bookmark, folderId: "other", tags: ["new"], readProgress: 0.5, isRead: true,
    completedAt: "2026-10-20T13:00:00.000Z", updatedAt: "2026-10-20T12:30:00.000Z",
  };
  assert.deepEqual(reconcileReadingProgress(bookmark, updated), {
    ...bookmark,
    readProgress: 0.5,
    isRead: true,
    completedAt: "2026-10-20T13:00:00.000Z",
    updatedAt: "2026-10-20T12:30:00.000Z",
  }, "a move/tag edit in flight is not reverted by the progress response");

  const stale = reconcileReadingProgress(bookmark, { ...updated, updatedAt: "2026-10-19T00:00:00.000Z" });
  assert.equal(stale.updatedAt, bookmark.updatedAt, "older responses do not move updatedAt backwards");
});
