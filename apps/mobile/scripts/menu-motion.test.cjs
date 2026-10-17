/** Production hooks with inert adapters: lifecycle checks, not native rendering. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { create } = require("zustand");

function hooks() {
  let cursor = 0;
  const slots = [], pending = [];
  const effect = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
      pending.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
    }
  };
  return {
    react: { ...React, useEffect: effect, useLayoutEffect: effect,
      useRef: (value) => slots[cursor++] ??= { current: value } },
    render(callback) { cursor = 0; const result = callback(); pending.splice(0).forEach((commit) => commit()); return result; },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}
function load(path, adapters) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(name in adapters, `Missing adapter: ${name}`); return adapters[name];
  }, module, module.exports);
  return module.exports;
}

test("row menu ownership releases on dismissal, retains nested pages and survives rapid reopen", () => {
  const h = hooks();
  const { useMenuHighlight, useMenuHighlightStore: store } = load("hooks/use-menu-highlight.ts", { react: h.react, zustand: { create } });
  const render = (visible, key = "bookmark:one") => h.render(() => useMenuHighlight(visible, key));
  render(false); assert.equal(store.getState().key, null);
  render(true); const owner = store.getState().owner;
  assert.equal(store.getState().key, "bookmark:one");
  render(true); assert.equal(store.getState().owner, owner, "nested pages don't reclaim or blink");
  render(false); assert.equal(store.getState().key, null, "no exit callback/timer before row fade starts");
  render(true); assert.notEqual(store.getState().owner, owner);
  render(true, "folder:two"); assert.equal(store.getState().key, "folder:two");
  render(true, null); assert.equal(store.getState().key, null);
  render(true); h.unmount(); assert.equal(store.getState().key, null);
});

test("older screen cleanup cannot clear a newer owner of the same row", () => {
  const h = hooks();
  const { useMenuHighlightStore: store } = load("hooks/use-menu-highlight.ts", { react: h.react, zustand: { create } });
  const older = store.getState().claim("bookmark:one");
  const newer = store.getState().claim("bookmark:one");
  const owner = store.getState().owner;
  older(); assert.equal(store.getState().owner, owner);
  newer(); assert.equal(store.getState().key, null);
});

test("disclosure motion skips mount springs, reverses in place and settles for reduced motion", () => {
  const h = hooks(), springs = [], cancellations = [];
  const motion = { reducedMotion: false, fast: { stiffness: 800, damping: 34, mass: 1 } };
  const values = [];
  const { DisclosureChevron } = load("components/ui/DisclosureChevron.tsx", {
    react: h.react,
    "react-native-reanimated": { default: { View: "AnimatedView" }, __esModule: true,
      useSharedValue: (initial) => { const ref = h.react.useRef({ value: initial }); values[0] = ref.current; return ref.current; },
      useAnimatedStyle: (callback) => ({ callback }),
      withSpring: (target, config) => { springs.push({ target, config }); return target; },
      cancelAnimation: (value) => cancellations.push(value) },
    "../../theme/material-motion": { useMaterialMotion: () => motion },
    "./MaterialIcon": { MaterialIcon: "MaterialIcon" },
  });
  const render = (expanded) => h.render(() => {
    const element = DisclosureChevron({ expanded, color: "theme-role" });
    return typeof element.type === "function" ? element.type(element.props) : element;
  });
  render(false); assert.equal(springs.length, 0);
  assert.equal(values.length, 0, "closed fields allocate no animation graph");
  render(true); render(false);
  assert.deepEqual(springs.map((entry) => entry.target), [1, 0]);
  assert.ok(springs.every((entry) => entry.config === motion.fast));
  render(false); assert.equal(springs.length, 2, "unchanged state does not restart motion");
  motion.reducedMotion = true;
  const settled = render(true);
  assert.equal(values[0].value, 1); assert.equal(springs.length, 2);
  assert.deepEqual(settled.props.style[1].callback(), { transform: [{ rotate: "180deg" }] });
  h.unmount(); assert.equal(cancellations.length, 1);
});
