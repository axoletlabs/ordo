import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FORCE_DARK_LIGHT_LUMINANCE,
  WEBSITE_FORCE_DARK_INVERT_CLASS,
  WEBSITE_FORCE_DARK_SCRIPT,
  cssColorLuminance,
  forceDarkBackgroundSamples,
  pageNeedsForceDarkInvert,
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

test("body is sampled before html so a light page stays inverted", () => {
  assert.deepEqual(
    forceDarkBackgroundSamples("rgb(17, 17, 17)", "rgb(255, 255, 255)", false),
    ["rgb(255, 255, 255)", "rgb(17, 17, 17)"],
  );
  assert.equal(
    pageNeedsForceDarkInvert("rgb(17, 17, 17)", "rgb(255, 255, 255)", false),
    true,
  );
});

test("invert backdrop on html does not undo force dark", () => {
  assert.deepEqual(
    forceDarkBackgroundSamples("rgb(17, 17, 17)", "rgb(255, 255, 255)", true),
    ["rgb(255, 255, 255)"],
  );
  assert.equal(
    pageNeedsForceDarkInvert("rgb(17, 17, 17)", "rgb(255, 255, 255)", true),
    true,
  );
  assert.equal(
    pageNeedsForceDarkInvert("rgb(17, 17, 17)", "transparent", true),
    true,
  );
});

test("a real dark body can still drop invert", () => {
  assert.equal(
    pageNeedsForceDarkInvert("rgb(255, 255, 255)", "rgb(18, 18, 18)", true),
    false,
  );
});

test("injected script inverts without observing the document tree", () => {
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, new RegExp(WEBSITE_FORCE_DARK_INVERT_CLASS));
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /html\{background-color:#fff/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /DOMContentLoaded/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, new RegExp(String(FORCE_DARK_LIGHT_LUMINANCE)));
  assert.doesNotMatch(WEBSITE_FORCE_DARK_SCRIPT, /MutationObserver/);
  assert.doesNotMatch(WEBSITE_FORCE_DARK_SCRIPT, /childList/);
  assert.doesNotMatch(WEBSITE_FORCE_DARK_SCRIPT, /color-scheme/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /requestAnimationFrame/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /true;\s*$/);
});
