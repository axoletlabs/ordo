import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FORCE_DARK_LIGHT_LUMINANCE,
  WEBSITE_FORCE_DARK_INVERT_CLASS,
  WEBSITE_FORCE_DARK_SCRIPT,
  cssColorLuminance,
  shouldInvertForForceDark,
} from "./website-force-dark.ts";

test("cssColorLuminance reads rgb and rgba", () => {
  assert.ok(Math.abs((cssColorLuminance("rgb(255, 255, 255)") ?? 0) - 1) < 1e-12);
  assert.equal(cssColorLuminance("rgb(0, 0, 0)"), 0);
  assert.ok((cssColorLuminance("rgba(255, 255, 255, 0.4)") ?? 0) > 0.9);
});

test("cssColorLuminance skips transparent and unknown values", () => {
  assert.equal(cssColorLuminance(null), null);
  assert.equal(cssColorLuminance(""), null);
  assert.equal(cssColorLuminance("transparent"), null);
  assert.equal(cssColorLuminance("rgba(0, 0, 0, 0)"), null);
  assert.equal(cssColorLuminance("#fff"), null);
});

test("light page backgrounds are inverted", () => {
  assert.equal(shouldInvertForForceDark(["rgb(255, 255, 255)"]), true);
  assert.equal(shouldInvertForForceDark(["rgb(247, 241, 222)"]), true);
  assert.equal(shouldInvertForForceDark([null, "rgb(255, 255, 255)"]), true);
});

test("dark page backgrounds are left alone", () => {
  assert.equal(shouldInvertForForceDark(["rgb(18, 18, 18)"]), false);
  assert.equal(shouldInvertForForceDark(["rgb(26, 26, 22)"]), false);
});

test("unknown backgrounds assume light (invert)", () => {
  assert.equal(shouldInvertForForceDark([]), true);
  assert.equal(shouldInvertForForceDark([null, "transparent"]), true);
});

test("first parseable background wins", () => {
  assert.equal(shouldInvertForForceDark(["transparent", "rgb(0, 0, 0)"]), false);
  assert.equal(shouldInvertForForceDark(["rgb(255, 255, 255)", "rgb(0, 0, 0)"]), true);
});

test("injected script carries the invert heuristic and iOS sentinel", () => {
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, new RegExp(WEBSITE_FORCE_DARK_INVERT_CLASS));
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /color-scheme/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, new RegExp(String(FORCE_DARK_LIGHT_LUMINANCE)));
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /true;\s*$/);
});
