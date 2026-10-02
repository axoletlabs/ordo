import assert from "node:assert/strict";
import { test } from "node:test";
import { readerColorSchemeOverride } from "./reader-color-scheme.ts";
import { materialColorRoles } from "./material-colors.ts";

/**
 * Contrast contract for reader light/sepia. Keep these hex values in sync with
 * `reader-theme.ts` (sepia). Light uses the actual generated Material roles.
 * Reader ink stays dark on light surfaces even when the app is in night mode.
 */
const light = materialColorRoles("#006A60", false, false, 0);
const LIGHT_BG = light.surface;
const LIGHT_INK = light.onSurface;
const LIGHT_BODY = light.onSurfaceVariant;
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

test("light reader uses dark ink on a Material surface", () => {
  assert.ok(luminance(LIGHT_BG) > 0.7);
  assert.ok(luminance(LIGHT_INK) < 0.15);
  assert.ok(luminance(LIGHT_BODY) < 0.2);
});

test("system reader does not pin the resolved color scheme", () => {
  assert.equal(readerColorSchemeOverride("system"), "unspecified");
  assert.equal(readerColorSchemeOverride("sepia"), "light");
  assert.equal(readerColorSchemeOverride("light"), "light");
  assert.equal(readerColorSchemeOverride("dark"), "dark");
});

test("sepia reader is warm paper with dark ink, not an inverted dark theme", () => {
  assert.ok(luminance(SEPIA_BG) > 0.7);
  assert.ok(luminance(SEPIA_SURFACE) > 0.7);
  assert.ok(luminance(SEPIA_INK) < 0.15);
  assert.ok(luminance(SEPIA_BODY) < 0.25);
});
