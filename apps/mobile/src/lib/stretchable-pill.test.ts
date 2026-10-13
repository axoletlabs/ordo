import assert from "node:assert/strict";
import { test } from "node:test";
import { stretchablePillGeometry } from "./stretchable-pill.ts";

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} vs ${expected}`);
}

test("transformed hit bounds follow the painted width and preserve the right edge", () => {
  for (const canvas of [272, 342, 792]) for (const width of [48, 64, 79.5, canvas / 2, canvas]) {
    const geometry = stretchablePillGeometry(width, canvas);
    const left = canvas / 2 + geometry.shift - canvas / 2 * geometry.scale;
    const right = canvas / 2 + geometry.shift + canvas / 2 * geometry.scale;
    near(right, canvas);
    near(right - left, width);
  }
});

test("counter-transform preserves icon, label and corner dimensions throughout a resize", () => {
  const canvas = 342;
  for (let frame = 0; frame <= 60; frame++) {
    const geometry = stretchablePillGeometry(79.5 + (canvas - 79.5) * frame / 60, canvas);
    function toWorld(x: number) {
      const counter = canvas / 2 + geometry.inverseShift + (x - canvas / 2) * geometry.inverseScale;
      return canvas / 2 + geometry.shift + (counter - canvas / 2) * geometry.scale;
    }
    for (const x of [0, 24, 100, canvas - 24, canvas]) near(toWorld(x), x);
    near(toWorld(122) - toWorld(100), 22);
  }
});

test("fixed end caps and stretchable middle meet without gaps", () => {
  for (const canvas of [272, 342, 792]) for (const width of [48, 64, 79.5, canvas / 2, canvas]) {
    const geometry = stretchablePillGeometry(width, canvas);
    const middleWidth = (canvas - 48) * geometry.middleScale;
    const middleCenter = canvas / 2 + geometry.shift;
    near(geometry.leadingShift + 24, middleCenter - middleWidth / 2);
    near(canvas - 24, middleCenter + middleWidth / 2);
  }
});

test("tiny, overflowing and zero-middle geometries never create invalid transforms", () => {
  for (const [width, canvas] of [[0, 342], [1000, 342], [48, 48], [0, 0]]) {
    const geometry = stretchablePillGeometry(width, canvas);
    assert.ok(Object.values(geometry).every(Number.isFinite));
    assert.ok(geometry.scale > 0 && geometry.scale <= 1);
    assert.ok(geometry.middleScale >= 0 && geometry.middleScale <= 1);
  }
});
