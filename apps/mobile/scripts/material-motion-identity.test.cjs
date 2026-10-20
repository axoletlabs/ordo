const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

function load() {
  const settings = { expressive: false, reducedMotion: false };
  const filename = process.env.ORDO_MOTION_SOURCE ?? resolve(__dirname, "../src/theme/material-motion.ts");
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  const mocks = {
    "../store/settings": { useSettingsStore: selector => selector(settings) },
    "../hooks/use-reduced-motion-preference": { useReducedMotionPreference: () => settings.reducedMotion },
  };
  new Function("require", "module", "exports", outputText)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, mod, mod.exports);
  return { ...mod.exports, settings };
}

test("all callers reuse the same scheme until expressive or reduced motion changes", () => {
  const { settings, useMaterialMotion, materialMotion } = load();
  const seen = new Set();
  for (const expressive of [false, true]) for (const reducedMotion of [false, true]) {
    Object.assign(settings, { expressive, reducedMotion });
    const scheme = useMaterialMotion();
    seen.add(scheme);
    assert.equal(scheme.expressive, expressive);
    assert.equal(scheme.reducedMotion, reducedMotion);
    for (const speed of ["fast", "spatial", "slow"]) {
      assert.equal(scheme[speed], materialMotion[expressive ? "expressive" : "standard"][speed]);
    }
    for (let caller = 0; caller < 100; caller++) assert.equal(useMaterialMotion(), scheme);
  }
  assert.equal(seen.size, 4);
  Object.assign(settings, { expressive: false, reducedMotion: false });
  const original = useMaterialMotion();
  settings.expressive = true;
  assert.notEqual(useMaterialMotion(), original);
  settings.expressive = false;
  assert.equal(useMaterialMotion(), original, "returning to a scheme reuses its original identity");
});

test("stable motion props let real memoized controls skip unrelated parent renders", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  const { settings, useMaterialMotion } = load();
  let renders = 0;
  const Label = React.memo(function Label({ motion }) {
    renders++;
    return React.createElement("span", null, `${motion.expressive}:${motion.reducedMotion}`);
  });
  function Control() { return React.createElement(Label, { motion: useMaterialMotion() }); }
  function Group({ revision }) {
    return React.createElement("div", { "data-revision": revision }, Array.from({ length: 64 }, (_, key) => React.createElement(Control, { key })));
  }
  try {
    for (let revision = 0; revision < 10; revision++) {
      await React.act(() => root.render(React.createElement(Group, { revision })));
    }
    assert.equal(renders, 64, "10 parent renders must not repaint 64 unchanged motion consumers 640 times");
    settings.reducedMotion = true;
    await React.act(() => root.render(React.createElement(Group, { revision: 10 })));
    assert.equal(renders, 128, "a real preference change still updates every control");
    settings.expressive = true;
    await React.act(() => root.render(React.createElement(Group, { revision: 11 })));
    assert.equal(renders, 192);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
