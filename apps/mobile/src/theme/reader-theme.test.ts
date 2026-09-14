import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Contrast contract for reader light/sepia. Keep these hex values in sync with
 * `theme.ts` (light) and `reader-theme.ts` (sepia). The reader must keep dark
 * ink on parchment even when the rest of the app is in night mode.
 */
const LIGHT_BG = "#EFE7D2";
const LIGHT_INK = "#15140F";
const LIGHT_BODY = "#2A2620";
const SEPIA_BG = "#F2E8D5";
const SEPIA_SURFACE = "#F7EFDF";
const SEPIA_INK = "#43351F";
const SEPIA_BODY = "#57452B";

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16) / 255;
  const g = Number.parseInt(n.slice(2, 4), 16) / 255;
  const b = Number.parseInt(n.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

test("light reader uses dark ink on parchment", () => {
  assert.ok(luminance(LIGHT_BG) > 0.7);
  assert.ok(luminance(LIGHT_INK) < 0.15);
  assert.ok(luminance(LIGHT_BODY) < 0.2);
});

test("sepia reader is warm paper with dark ink, not an inverted dark theme", () => {
  assert.ok(luminance(SEPIA_BG) > 0.7);
  assert.ok(luminance(SEPIA_SURFACE) > 0.7);
  assert.ok(luminance(SEPIA_INK) < 0.15);
  assert.ok(luminance(SEPIA_BODY) < 0.25);
});
