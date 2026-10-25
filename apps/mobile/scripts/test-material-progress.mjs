#!/usr/bin/env node
/** Geometry regressions for indicators shared by native and web. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/material-progress.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const geometry = { exports: {} };
vm.runInThisContext(`(function(exports){${outputText}\n})`)(geometry.exports);
const { linearIndeterminateSegments, linearTrackSegments, straightProgressPath,
  wavyProgressPath, circularIndeterminateArc, circularProgressPaths } = geometry.exports;

function coordinates(path) {
  return (path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
}

test("linear track keeps gaps around both chasing segments throughout the loop", () => {
  for (const width of [24, 312, 560, 1040]) {
    for (let frame = 0; frame <= 1800; frame++) {
      const segments = linearIndeterminateSegments(frame / 1800)
        .map(({ start, end }) => ({ start: start * width, end: end * width }));
      const track = linearTrackSegments(segments, width);
      for (const span of track) {
        assert.ok(span.start >= 0 && span.end <= width && span.end > span.start);
        for (const active of segments.filter(s => s.end > s.start)) {
          assert.ok(span.end <= active.start - 4 + 1e-9 || span.start >= active.end + 4 - 1e-9,
            `Track overlaps active segment at frame ${frame}, width ${width}`);
        }
      }
    }
  }
});

test("empty and completed progress do not leave phantom gaps or track", () => {
  assert.deepEqual(linearTrackSegments([{ start: 0, end: 0 }], 100), [{ start: 0, end: 100 }]);
  assert.deepEqual(linearTrackSegments([{ start: 0, end: 100 }], 100), []);
  assert.deepEqual(linearTrackSegments([{ start: 0, end: 50 }], 100), [{ start: 54, end: 100 }]);
  assert.deepEqual(linearTrackSegments([{ start: 0, end: 0 }], 0), []);
});

test("rounded caps stay inside each straight segment and tiny segments never reverse", () => {
  assert.equal(straightProgressPath(0, 100), "M2,2 L98,2");
  assert.equal(straightProgressPath(15, 50, 5), "M17,5 L48,5");
  assert.equal(straightProgressPath(0, 3), "");
  assert.equal(straightProgressPath(10, 10), "");
});

test("linear waves, including stationary reduced-motion waves, fit their 10dp region", () => {
  for (const width of [24, 312, 560]) {
    for (let frame = 0; frame < 100; frame++) {
      for (const wavelength of [20, 40]) {
        const path = wavyProgressPath(0, width, width, frame / 100, 3, wavelength);
        const parts = path.split(" C");
        let [x, y] = coordinates(parts.shift());
        for (const part of parts) {
          const [ax, ay, bx, by, endX, endY] = coordinates(part);
          for (let sample = 0; sample <= 20; sample++) {
            const t = sample / 20, u = 1 - t;
            const px = u ** 3 * x + 3 * u ** 2 * t * ax + 3 * u * t ** 2 * bx + t ** 3 * endX;
            const py = u ** 3 * y + 3 * u ** 2 * t * ay + 3 * u * t ** 2 * by + t ** 3 * endY;
            assert.ok(px >= 2 - 1e-9 && px <= width - 2 + 1e-9);
            assert.ok(py >= 2 - 1e-9 && py <= 8 + 1e-9);
          }
          x = endX;
          y = endY;
        }
      }
    }
  }
  assert.equal(wavyProgressPath(0, 0, 0, 0, 3, 40), "");
});

test("circular arcs and their waves leave room for the stroke in a 40dp box", () => {
  for (let frame = 0; frame <= 540; frame++) {
    const { start, sweep } = circularIndeterminateArc(frame / 540);
    for (const wavy of [false, true]) {
      const paths = circularProgressPaths(start, sweep, wavy);
      assert.ok(paths.indicator.length > 0 && paths.track.length > 0);
      for (const path of Object.values(paths)) {
        assert.ok(!/NaN|Infinity/.test(path));
        for (const value of coordinates(path)) assert.ok(value >= 2 && value <= 38);
      }
    }
  }
});

test("circular animation closes its loop and static reduced-motion arcs remain visible", () => {
  const initial = circularIndeterminateArc(0), final = circularIndeterminateArc(1);
  assert.equal(final.sweep, initial.sweep);
  assert.equal((final.start - initial.start) % 360, 0);
  for (const wavy of [false, true]) {
    const paused = circularProgressPaths(-90, 90, wavy);
    assert.ok(paused.indicator && paused.track);
  }
});
