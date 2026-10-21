/** Run with: node --test apps/mobile/scripts/animation-activity-scope.test.cjs
 *
 * Actual-source activity scope contract. The host publishes a stable external
 * store; only animation leaf hooks subscribe to it. The legacy boolean context
 * stays a cheap inheritance channel for page/layer owners.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return { dom, previous };
}

function teardownDom({ dom, previous }) {
  dom.window.close();
  globalThis.window = previous.window;
  globalThis.document = previous.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
}

function loadActivity(platform = "web") {
  const appState = { currentState: "active", listener: null,
    addEventListener(_type, listener) { this.listener = listener; return { remove: () => { this.listener = null; } }; } };
  const reactNative = { Platform: { OS: platform }, AppState: appState };
  const filename = resolve(sourceRoot, "hooks/use-animation-activity.ts");
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(id => {
    if (id === "react") return React;
    if (id === "react-native") return reactNative;
    throw new Error(`Unexpected dependency: ${id}`);
  }, module, module.exports);
  return { activity: module.exports, appState };
}

test("activity scope is a stable external store", () => {
  const { activity } = loadActivity();
  const scope = activity.createAnimationActivityScope();
  const seen = [];
  const unsubscribe = scope.subscribe(() => seen.push(scope.getSnapshot()));
  assert.equal(scope.getSnapshot(), true);
  scope.setActive(false);
  scope.setActive(false);
  assert.equal(scope.getSnapshot(), false);
  scope.setActive(true);
  assert.deepEqual(seen, [false, true]);
  unsubscribe();
  scope.setActive(false);
  assert.deepEqual(seen, [false, true]);
  assert.equal(scope.getSnapshot(), false);
});

test("useAnimationActivity combines legacy, host scope and foreground", async () => {
  const { dom, previous } = setupDom();
  const { activity } = loadActivity("web");
  const { AnimationActivityContext, AnimationActivityScopeContext, createAnimationActivityScope, useAnimationActivity } = activity;
  const scope = createAnimationActivityScope();
  const values = [];
  let hidden = false;
  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    get: () => hidden ? "hidden" : "visible",
  });

  function Probe() {
    values.push(useAnimationActivity());
    return null;
  }
  const scene = ({ legacy = true, withScope = true }) => {
    const probe = React.createElement(Probe);
    return React.createElement(AnimationActivityContext.Provider, { value: legacy },
      withScope ? React.createElement(AnimationActivityScopeContext.Provider, { value: scope }, probe) : probe);
  };
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(scene({})));
    assert.equal(values.at(-1), true);

    await React.act(() => scope.setActive(false));
    assert.equal(values.at(-1), false, "host scope pauses leaf activity");

    await React.act(() => scope.setActive(true));
    assert.equal(values.at(-1), true, "host scope release resumes leaf activity");

    await React.act(() => root.render(scene({ legacy: false })));
    assert.equal(values.at(-1), false, "legacy pause still wins over an active host scope");

    await React.act(() => root.render(scene({ legacy: true, withScope: false })));
    assert.equal(values.at(-1), true, "no host scope means only the legacy/foreground gates apply");

    hidden = true;
    await React.act(() => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(values.at(-1), false, "app foreground still pauses leaves independently");

    hidden = false;
    await React.act(() => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(values.at(-1), true);
  } finally {
    await React.act(() => root.unmount());
    teardownDom({ dom, previous });
  }
});
