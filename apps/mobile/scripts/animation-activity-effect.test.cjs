/** Run with: node --test apps/mobile/scripts/animation-activity-effect.test.cjs
 *
 * Actual-source effect-only activity subscription. It must never re-render a
 * component for scope/foreground changes, but must synchronously cancel the
 * previous callback cleanup on pause, replacement and unmount.
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return { dom, previous };
}

function teardownDom({ dom, previous }) {
  dom.window.close();
  globalThis.window = previous.window;
  globalThis.document = previous.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
}

function loadActivity() {
  const appState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
  const filename = resolve(sourceRoot, "hooks/use-animation-activity.ts");
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(id => {
    if (id === "react") return React;
    if (id === "react-native") return { Platform: { OS: "web" }, AppState: appState };
    throw new Error(`Unexpected dependency: ${id}`);
  }, module, module.exports);
  return module.exports;
}

function renderProbe(activity, { legacy = true, scope = null, callback } = {}) {
  const { AnimationActivityContext, AnimationActivityScopeContext, useAnimationActivityEffect } = activity;
  let renders = 0;
  function Probe() {
    renders += 1;
    useAnimationActivityEffect(callback);
    return null;
  }
  const tree = (legacyValue, scopeValue) => React.createElement(AnimationActivityContext.Provider, { value: legacyValue },
    scopeValue ? React.createElement(AnimationActivityScopeContext.Provider, { value: scopeValue }, React.createElement(Probe))
      : React.createElement(Probe));
  return { Probe, tree, renders: () => renders };
}

test("scope/foreground transitions do not render; cleanup runs synchronously", async () => {
  const { dom, previous } = setupDom();
  const activity = loadActivity();
  const scope = activity.createAnimationActivityScope();
  const events = [];
  const cleanups = [];
  let renders = 0;
  function Probe() {
    renders += 1;
    activity.useAnimationActivityEffect(React.useCallback((active) => {
      events.push(active);
      return () => cleanups.push(active);
    }, []));
    return null;
  }
  const tree = (value) => React.createElement(activity.AnimationActivityContext.Provider, { value: true },
    React.createElement(activity.AnimationActivityScopeContext.Provider, { value: scope }, React.createElement(Probe)));
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(tree()));
    assert.deepEqual(events, [true]);
    assert.equal(renders, 1);

    await React.act(() => scope.setActive(false));
    assert.deepEqual(events, [true, false], "pause callback runs once");
    assert.deepEqual(cleanups, [true], "active cleanup runs before pause callback");
    assert.equal(renders, 1, "scope pause must not render the probe");

    await React.act(() => scope.setActive(true));
    assert.deepEqual(events, [true, false, true]);
    assert.deepEqual(cleanups, [true, false], "paused cleanup runs before resume");
    assert.equal(renders, 1, "scope resume must not render the probe");

    let hidden = true;
    Object.defineProperty(dom.window.document, "visibilityState", {
      configurable: true,
      get: () => hidden ? "hidden" : "visible",
    });
    await React.act(() => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(events.at(-1), false, "app background pauses work");
    assert.equal(renders, 1, "foreground changes must not render the probe");
    hidden = false;
    await React.act(() => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(events.at(-1), true);
    assert.equal(renders, 1);
  } finally {
    await React.act(() => root.unmount());
    assert.deepEqual(cleanups, [true, false, true, false, true], "unmount cancels the active cleanup");
    teardownDom({ dom, previous });
  }
});

test("legacy context still re-renders and pauses; scope replacement cancels the old subscription", async () => {
  const { dom, previous } = setupDom();
  const activity = loadActivity();
  const first = activity.createAnimationActivityScope();
  const second = activity.createAnimationActivityScope();
  const events = [];
  const cleanups = [];
  let renders = 0;
  function Probe({ scope }) {
    renders += 1;
    activity.useAnimationActivityEffect(React.useCallback((active) => {
      events.push(active);
      return () => cleanups.push(active);
    }, []));
    return null;
  }
  const tree = (legacy, scope) => React.createElement(activity.AnimationActivityContext.Provider, { value: legacy },
    React.createElement(activity.AnimationActivityScopeContext.Provider, { value: scope }, React.createElement(Probe, { scope })));
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(tree(true, first)));
    assert.deepEqual(events, [true]);
    const rendersBeforeLegacy = renders;
    await React.act(() => root.render(tree(false, first)));
    assert.deepEqual(events, [true, false], "legacy false pauses through the render dependency");
    assert.ok(renders > rendersBeforeLegacy, "legacy route/context changes may render");
    await React.act(() => root.render(tree(true, first)));
    assert.deepEqual(events, [true, false, true]);

    const eventsBeforeReplacement = events.length;
    await React.act(() => root.render(tree(true, second)));
    assert.deepEqual(cleanups, [true, false, true], "replacing the scope cancels the old callback");
    assert.equal(events.length, eventsBeforeReplacement + 1, "the new scope establishes its active snapshot");
    assert.equal(events.at(-1), true);

    await React.act(() => first.setActive(false));
    assert.equal(events.at(-1), true, "the replaced scope no longer drives the probe");
    await React.act(() => second.setActive(false));
    assert.equal(events.at(-1), false);
  } finally {
    await React.act(() => root.unmount());
    teardownDom({ dom, previous });
  }
});

test("subscribe-before-read and reentrant updates settle on the latest snapshot", async () => {
  const { dom, previous } = setupDom();
  const activity = loadActivity();
  const events = [];
  let subscribed = false;
  const racingScope = {
    getSnapshot: () => false,
    subscribe(listener) { subscribed = true; listener(); return () => {}; },
    setActive() {},
  };
  const race = renderProbe(activity, { scope: racingScope, callback: (active) => {
    events.push(active);
  } });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(race.tree(true, racingScope)));
    assert.equal(subscribed, true);
    assert.deepEqual(events, [false], "synchronous subscription notification is not duplicated by the initial read");
  } finally {
    await React.act(() => root.unmount());
  }

  const scope = activity.createAnimationActivityScope();
  const reentrantEvents = [];
  let cleanupActive = 0;
  function ReentrantProbe() {
    activity.useAnimationActivityEffect(React.useCallback((active) => {
      reentrantEvents.push(active);
      if (active) scope.setActive(false);
      return () => { if (active) cleanupActive += 1; };
    }, [scope]));
    return null;
  }
  const root2 = createRoot(dom.window.document.createElement("div"));
  try {
    await React.act(() => root2.render(React.createElement(activity.AnimationActivityContext.Provider, { value: true },
      React.createElement(activity.AnimationActivityScopeContext.Provider, { value: scope }, React.createElement(ReentrantProbe)))));
    assert.deepEqual(reentrantEvents, [true, false], "reentrant pause is applied after the active callback returns");
    assert.equal(cleanupActive, 1, "the active cleanup is cancelled before the paused callback");
  } finally {
    await React.act(() => root2.unmount());
    teardownDom({ dom, previous });
  }
});
