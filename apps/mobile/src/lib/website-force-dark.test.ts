import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  FORCE_DARK_CONTENT_SELECTORS,
  FORCE_DARK_LIGHT_LUMINANCE,
  WEBSITE_FORCE_DARK_INVERT_CLASS,
  WEBSITE_FORCE_DARK_SCRIPT,
  cssColorChannelKey,
  cssColorLuminance,
  forceDarkBackgroundSamples,
  isForceDarkChromePaint,
  nativeDarkAttributeUpdates,
  pageNeedsForceDarkInvert,
  shouldInvertForForceDark,
} from "./website-force-dark.ts";

test("cssColorLuminance reads rgb, rgba, and hex", () => {
  assert.ok(Math.abs((cssColorLuminance("rgb(255, 255, 255)") ?? 0) - 1) < 1e-12);
  assert.equal(cssColorLuminance("rgb(0, 0, 0)"), 0);
  assert.ok((cssColorLuminance("rgba(255, 255, 255, 0.4)") ?? 0) > 0.9);
  assert.ok(Math.abs((cssColorLuminance("#fff") ?? 0) - 1) < 1e-12);
  assert.equal(cssColorLuminance("#000"), 0);
  assert.equal(cssColorChannelKey("#1A1A16"), cssColorChannelKey("rgb(26, 26, 22)"));
});

test("cssColorLuminance skips transparent and unknown values", () => {
  assert.equal(cssColorLuminance(null), null);
  assert.equal(cssColorLuminance(""), null);
  assert.equal(cssColorLuminance("transparent"), null);
  assert.equal(cssColorLuminance("rgba(0, 0, 0, 0)"), null);
  assert.equal(cssColorLuminance("rebeccapurple"), null);
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

test("a light main beats a color-scheme-dark html canvas", () => {
  assert.equal(
    pageNeedsForceDarkInvert("rgb(0, 0, 0)", "transparent", false, ["rgb(255, 255, 255)"]),
    true,
  );
});

test("a dark main drops invert even if html was painted", () => {
  assert.equal(
    pageNeedsForceDarkInvert("rgb(17, 17, 17)", "transparent", true, ["rgb(13, 17, 23)"]),
    false,
  );
});

test("ordo chrome paint is not treated as a dark page", () => {
  assert.equal(isForceDarkChromePaint("rgb(26, 26, 22)", "#1A1A16"), true);
  assert.equal(isForceDarkChromePaint("rgb(255, 255, 255)", "#1A1A16"), false);
  assert.equal(
    pageNeedsForceDarkInvert("rgb(26, 26, 22)", "rgb(26, 26, 22)", false, [], "#1A1A16"),
    true,
  );
  assert.deepEqual(
    forceDarkBackgroundSamples("rgb(26, 26, 22)", "rgb(26, 26, 22)", true, [], "#1A1A16"),
    [null],
  );
});

test("native dark only rewrites theme attributes the site already set", () => {
  assert.deepEqual(nativeDarkAttributeUpdates({ "data-color-mode": "auto" }), {
    "data-color-mode": "dark",
  });
  assert.deepEqual(nativeDarkAttributeUpdates({ "data-color-mode": "light" }), {
    "data-color-mode": "dark",
  });
  assert.deepEqual(nativeDarkAttributeUpdates({ "data-theme": "system" }), {
    "data-theme": "dark",
  });
  assert.deepEqual(nativeDarkAttributeUpdates({ "data-bs-theme": "light" }), {
    "data-bs-theme": "dark",
  });
  assert.deepEqual(nativeDarkAttributeUpdates({ "data-color-mode": "dark" }), {});
  assert.deepEqual(nativeDarkAttributeUpdates({ "data-color-mode": "dark_dimmed" }), {});
  assert.deepEqual(nativeDarkAttributeUpdates({}), {});
});

test("injected script asks for native dark and inverts body, not the root", () => {
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, new RegExp(WEBSITE_FORCE_DARK_INVERT_CLASS));
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /color-scheme:dark/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /data-color-mode/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /matchMedia/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /prefers-color-scheme/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /html\{background-color:#111/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, />body\{filter:invert\(1\)/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /elementsFromPoint/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /ordo-browser-chrome/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /DOMContentLoaded/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, new RegExp(String(FORCE_DARK_LIGHT_LUMINANCE)));
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /application-main/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /#__next/);
  assert.equal(
    WEBSITE_FORCE_DARK_SCRIPT.includes(JSON.stringify(FORCE_DARK_CONTENT_SELECTORS)),
    true,
  );
  assert.doesNotMatch(WEBSITE_FORCE_DARK_SCRIPT, /MutationObserver/);
  assert.doesNotMatch(WEBSITE_FORCE_DARK_SCRIPT, /childList/);
  assert.doesNotMatch(WEBSITE_FORCE_DARK_SCRIPT, /background-image/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /requestAnimationFrame/);
  assert.match(WEBSITE_FORCE_DARK_SCRIPT, /true;\s*$/);
});

test("force-dark refinements skip identical page-wide writes but still follow a theme change", () => {
  const callbacks: Array<() => void> = [];
  const nodes = new Map<string, ReturnType<typeof node>>();
  const classes = new Set<string>();
  let stylesheetWrites = 0, schemeWrites = 0, metaWrites = 0, classWrites = 0;
  let colorScheme = "", background = "rgb(255, 255, 255)";
  function node() {
    const attributes = new Map<string, string>();
    let text = "";
    return {
      id: "",
      get textContent() { return text; },
      set textContent(value: string) { stylesheetWrites++; text = value; },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        if (name === "content") metaWrites++;
        attributes.set(name, value);
      },
    };
  }
  const root = { ...node(), style: {
    get colorScheme() { return colorScheme; },
    set colorScheme(value: string) { schemeWrites++; colorScheme = value; },
  }, classList: {
    contains: (name: string) => classes.has(name),
    add: (name: string) => { classWrites++; classes.add(name); },
    remove: (name: string) => { classWrites++; classes.delete(name); },
  } };
  const context = {
    window: {},
    document: {
      documentElement: root, body: {}, readyState: "complete",
      head: {
        firstChild: null,
        appendChild: (element: ReturnType<typeof node>) => nodes.set(element.id, element),
        insertBefore: (element: ReturnType<typeof node>) => nodes.set("meta", element),
      },
      getElementById: (id: string) => nodes.get(id) ?? null,
      querySelector: (selector: string) => selector.startsWith("meta[") ? nodes.get("meta") ?? null : null,
      createElement: node,
    },
    getComputedStyle: () => ({ backgroundColor: background }),
    requestAnimationFrame: (callback: () => void) => callbacks.push(callback),
    setTimeout: (callback: () => void) => callbacks.push(callback),
  };
  runInNewContext(WEBSITE_FORCE_DARK_SCRIPT, context);
  callbacks.forEach(callback => callback());
  runInNewContext(WEBSITE_FORCE_DARK_SCRIPT, context);
  assert.equal(stylesheetWrites, 1);
  assert.equal(schemeWrites, 1);
  assert.equal(metaWrites, 1);
  assert.equal(classWrites, 1);
  background = "rgb(18, 18, 18)";
  runInNewContext(WEBSITE_FORCE_DARK_SCRIPT, context);
  assert.equal(stylesheetWrites, 2, "A real dark page must remove the inversion");
  assert.equal(classWrites, 2);
  assert.equal(classes.size, 0);
  runInNewContext(WEBSITE_FORCE_DARK_SCRIPT, context);
  assert.equal(stylesheetWrites, 2);
  assert.equal(classWrites, 2);
});
