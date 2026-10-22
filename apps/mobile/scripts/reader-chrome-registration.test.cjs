/** Run with: node --test apps/mobile/scripts/reader-chrome-registration.test.cjs
 *
 * Deterministic JS regression for the reader chrome scroll worklets.
 *
 * The real `use-reader-chrome.ts` and `lib/fab-scroll.ts` are transformed with
 * the real Expo Babel preset + react-native-worklets plugin, so the assertions
 * run against actual `__workletHash` / `__closure` metadata, not mock function
 * identity. The test harness mirrors Reanimated's captured-closure comparison
 * and event registration counts.
 *
 * Guards:
 *  - an unrelated rerender must reuse the captured worklet closures and skip
 *    every scroll-event re-registration;
 *  - reduced-motion and spatial-scheme changes must rebuild once and use the
 *    new values;
 *  - settle target selection, overshoot clamping, momentum, scroll clamping,
 *    pinning and programmatic restoration keep their existing behavior.
 *
 * No native frames are measured here; this is a registration/closure test.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const babel = require("@babel/core");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");

/* ------------------------------- DOM / React -------------------------------- */

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act } = React;

/* ---------------------------- actual worklet load --------------------------- */

const SPRING_A = Object.freeze({ stiffness: 700, damping: 50, mass: 1 });
const SPRING_B = Object.freeze({ stiffness: 380, damping: 35, mass: 1 });
const EFFECT_SPRING = Object.freeze({ stiffness: 3800, damping: 100, mass: 1 });

const motionState = { reducedMotion: false, spatial: SPRING_A, expressive: false };
const materialMotion = { effects: { fast: EFFECT_SPRING } };

function transformSource(filename) {
  const source = readFileSync(filename, "utf8");
  return babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [[require.resolve("babel-preset-expo"), {}]],
    plugins: [[require.resolve("react-native-worklets/plugin")]],
  }).code;
}

function loadTransformed(relativePath, stubs) {
  const filename = resolve(sourceRoot, relativePath);
  const code = transformSource(filename);
  const module = { exports: {} };
  const localRequire = (name) => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

// Load the real scroll-state worklet first. It has no imports, so it is not
// affected by the harness stubs used for the hook.
const { stepFabScrollState } = loadTransformed("lib/fab-scroll.ts", {});

/* ------------------------- Reanimated test harness -------------------------- */

const registry = {
  rebuilds: 0,
  registrations: 0,
  eventNames: [],
  handlers: null,
};

const springCalls = [];

function closureEqual(next, previous) {
  const nextKeys = Object.keys(next ?? {});
  const previousKeys = Object.keys(previous ?? {});
  return nextKeys.length === previousKeys.length
    && nextKeys.every((key) => Object.prototype.hasOwnProperty.call(previous, key)
      && Object.is(next[key], previous[key]));
}

function workletEqual(next, previous) {
  if (next === previous) return true;
  return next?.__workletHash === previous?.__workletHash
    && closureEqual(next?.__closure, previous?.__closure);
}

function handlersEqual(next, previous) {
  const nextKeys = Object.keys(next);
  const previousKeys = Object.keys(previous ?? {});
  return nextKeys.length === previousKeys.length
    && nextKeys.every((key) => workletEqual(next[key], previous?.[key]));
}

const EVENT_NAMES = {
  onScroll: "onScroll",
  onBeginDrag: "onScrollBeginDrag",
  onEndDrag: "onScrollEndDrag",
  onMomentumBegin: "onMomentumScrollBegin",
  onMomentumEnd: "onMomentumScrollEnd",
};

function useSharedValue(initial) {
  const slot = React.useRef(null);
  if (slot.current === null) slot.current = { value: initial };
  return slot.current;
}

/** Mirrors Reanimated's useAnimatedScrollHandler registration boundary. */
function useAnimatedScrollHandler(handlers) {
  const slot = React.useRef({ previousHandlers: null, processed: null });
  const registers = Object.keys(EVENT_NAMES).filter((key) => typeof handlers[key] === "function");
  const changed = !slot.current.previousHandlers || !handlersEqual(handlers, slot.current.previousHandlers);

  if (changed) {
    slot.current.previousHandlers = handlers;
    registry.rebuilds += 1;
    registry.registrations += registers.length;
    registry.eventNames = registers.map((key) => EVENT_NAMES[key]);
    registry.handlers = handlers;
  }
  if (!slot.current.processed) {
    slot.current.processed = (event) => registry.handlers?.onScroll?.(event);
  }
  return slot.current.processed;
}

const reanimated = {
  useSharedValue,
  useAnimatedScrollHandler,
  withSpring(value, config) {
    springCalls.push({ value, config });
    return value;
  },
  cancelAnimation() {},
};

const reactNative = {
  Platform: { OS: "android", select: (options) => options.android ?? options.default },
};

const hookModule = loadTransformed("hooks/use-reader-chrome.ts", {
  react: React,
  "react-native": reactNative,
  "react-native-reanimated": reanimated,
  "../lib/fab-scroll": { stepFabScrollState },
  "../theme/material-motion": {
    useMaterialMotion: () => motionState,
    materialMotion,
  },
});

const { useReaderChrome } = hookModule;

/* ------------------------------- test harness ------------------------------- */

let latestApi = null;

function Harness({ keepExpanded, height, tick }) {
  // `tick` is only here to force a real component pass without changing the
  // hook's inputs. It must not cause a worklet rebuild.
  void tick;
  latestApi = useReaderChrome(keepExpanded, height);
  return null;
}

function resetHarness() {
  registry.rebuilds = 0;
  registry.registrations = 0;
  registry.eventNames = [];
  registry.handlers = null;
  springCalls.length = 0;
  motionState.reducedMotion = false;
  motionState.spatial = SPRING_A;
  latestApi = null;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const height = { value: 100 };
  let tick = 0;

  const render = async (keepExpanded = false) => {
    tick += 1;
    await act(async () => {
      root.render(React.createElement(Harness, { keepExpanded, height, tick }));
    });
  };

  await render(false);
  return {
    root,
    container,
    height,
    render,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

function runWorklet(worklet, ...args) {
  assert.equal(typeof worklet, "function", "expected an actual worklet function");
  // The worklets Babel plugin puts captured values on `this.__closure`.
  return worklet.apply(worklet, args);
}

function scrollEvent(offset, contentHeight = 500, viewportHeight = 300) {
  return {
    contentOffset: { y: offset },
    contentSize: { height: contentHeight },
    layoutMeasurement: { height: viewportHeight },
  };
}

/* ---------------------------------- tests ----------------------------------- */

test("unchanged rerenders reuse captured worklets and skip scroll registrations", async (t) => {
  resetHarness();
  const view = await mount();
  try {
    assert.equal(registry.rebuilds, 1, "the first render registers the handler once");
    assert.equal(registry.registrations, 5, "all five scroll events register");
    assert.deepEqual(registry.eventNames, [
      "onScroll",
      "onScrollBeginDrag",
      "onScrollEndDrag",
      "onMomentumScrollBegin",
      "onMomentumScrollEnd",
    ]);

    const first = registry.handlers;
    assert.equal(typeof first.onEndDrag.__workletHash, "number", "the source ran through the worklets Babel plugin");
    assert.equal(typeof first.onEndDrag.__closure, "object");
    assert.equal(typeof first.onEndDrag.__closure.settle.__workletHash, "number");

    // A forced component pass with unchanged motion/shared values must not
    // rebuild the handler or re-register its events.
    await view.render(false);
    assert.equal(registry.rebuilds, 1, "an unrelated rerender does not rebuild the handler");
    assert.equal(registry.registrations, 5, "an unrelated rerender does not re-register events");
    assert.strictEqual(registry.handlers, first, "the registered handler set is unchanged");
    assert.strictEqual(registry.handlers.onEndDrag, first.onEndDrag, "the onEndDrag worklet identity is stable");
    assert.strictEqual(
      registry.handlers.onEndDrag.__closure.settle,
      first.onEndDrag.__closure.settle,
      "the captured settle worklet is the same function",
    );

    // Preserve settle target selection and overshoot clamping.
    latestApi.hidden.value = 60;
    springCalls.length = 0;
    runWorklet(first.onEndDrag);
    assert.equal(latestApi.hidden.value, 100, "past halfway settles to the full chrome height");
    assert.equal(springCalls.length, 1);
    assert.equal(springCalls[0].value, 100);
    assert.equal(springCalls[0].config.overshootClamping, true, "settle keeps overshoot clamping");
    assert.strictEqual(springCalls[0].config.stiffness, SPRING_A.stiffness, "settle keeps the spatial spring");

    latestApi.hidden.value = 40;
    springCalls.length = 0;
    runWorklet(first.onEndDrag);
    assert.equal(latestApi.hidden.value, 0, "below halfway settles back to hidden");
    assert.equal(springCalls[0].value, 0);
    t.diagnostic("unchanged rerender: rebuilds=1, registrations=5");
  } finally {
    await view.unmount();
  }
});

test("reduced-motion changes rebuild once, bypass springs, and keep direct targets", async (t) => {
  resetHarness();
  const view = await mount();
  try {
    const before = registry.rebuilds;
    motionState.reducedMotion = true;
    await view.render(false);

    assert.equal(registry.rebuilds, before + 1, "reduced motion changes the captured worklet closures");
    assert.equal(registry.registrations, 10, "the five events are re-registered once");
    const reduced = registry.handlers;
    assert.notStrictEqual(reduced.onEndDrag, undefined);
    assert.equal(reduced.onEndDrag.__closure.settle.__closure.reducedMotion, true,
      "the nested settle worklet captured reduced motion");

    latestApi.hidden.value = 60;
    springCalls.length = 0;
    runWorklet(reduced.onEndDrag);
    assert.equal(latestApi.hidden.value, 100, "settle target is still the full chrome height");
    assert.equal(springCalls.length, 0, "reduced motion writes the target without a spring");

    latestApi.hidden.value = 40;
    runWorklet(reduced.onEndDrag);
    assert.equal(latestApi.hidden.value, 0, "reduced motion still selects the near target");
    assert.equal(springCalls.length, 0);

    // The scroll worklet must also update the expansion values directly.
    runWorklet(reduced.onBeginDrag, scrollEvent(0));
    latestApi.hidden.value = 0;
    springCalls.length = 0;
    runWorklet(reduced.onScroll, scrollEvent(200, 500, 300));
    assert.equal(latestApi.hidden.value, 100, "scroll still clamps the hidden chrome to its height");
    assert.equal(latestApi.expansion.spatial.value, 0, "collapsed spatial state is written directly");
    assert.equal(latestApi.expansion.effects.value, 0, "collapsed effects state is written directly");
    assert.equal(springCalls.length, 0, "reduced motion does not spring the collapse states");
    t.diagnostic("reduced motion: rebuilds=" + registry.rebuilds + ", registrations=" + registry.registrations);
  } finally {
    await view.unmount();
  }
});

test("a spatial-scheme change rebuilds with the new spring values", async (t) => {
  resetHarness();
  const view = await mount();
  try {
    const before = registry.rebuilds;
    motionState.spatial = SPRING_B;
    await view.render(false);

    assert.equal(registry.rebuilds, before + 1, "the spatial spring is part of the settle closure");
    assert.equal(registry.registrations, 10);
    const changed = registry.handlers;
    assert.strictEqual(changed.onEndDrag.__closure.settle.__closure.spring, SPRING_B);

    latestApi.hidden.value = 60;
    springCalls.length = 0;
    runWorklet(changed.onEndDrag);
    assert.equal(latestApi.hidden.value, 100);
    assert.equal(springCalls.length, 1);
    assert.strictEqual(springCalls[0].config.stiffness, SPRING_B.stiffness, "the new spatial spring is used");
    assert.equal(springCalls[0].config.overshootClamping, true);
    t.diagnostic("spatial scheme: rebuilds=" + registry.rebuilds + ", registrations=" + registry.registrations);
  } finally {
    await view.unmount();
  }
});

test("momentum, scroll clamping, pinning and programmatic restoration are preserved", async (t) => {
  resetHarness();
  const view = await mount();
  try {
    const handlers = registry.handlers;

    // Scroll clamping: a long drag past the content end clamps both the
    // offset and the hidden chrome to the measured height.
    runWorklet(handlers.onBeginDrag, scrollEvent(0));
    latestApi.hidden.value = 0;
    springCalls.length = 0;
    runWorklet(handlers.onScroll, scrollEvent(200, 500, 300));
    assert.equal(latestApi.hidden.value, 100);
    assert.equal(latestApi.expansion.spatial.value, 0);
    assert.ok(springCalls.some((call) => call.value === 0 && call.config === SPRING_A),
      "the collapse uses the spatial spring");

    // The scroll offset itself is clamped to the content bottom, not just the
    // hidden chrome: 500 - 450 = 50.
    latestApi.hidden.value = 0;
    springCalls.length = 0;
    runWorklet(handlers.onBeginDrag, scrollEvent(0));
    runWorklet(handlers.onScroll, scrollEvent(400, 500, 450));
    assert.equal(latestApi.hidden.value, 50, "overscroll is clamped to the real content end");

    // Momentum: onMomentumEnd only settles when user momentum was armed by
    // onBeginDrag; onEndDrag itself settles once.
    latestApi.hidden.value = 60;
    springCalls.length = 0;
    runWorklet(handlers.onMomentumBegin);
    runWorklet(handlers.onEndDrag);
    assert.equal(latestApi.hidden.value, 100);
    assert.equal(springCalls.length, 1, "onEndDrag settles once");
    runWorklet(handlers.onMomentumEnd);
    assert.equal(latestApi.hidden.value, 100);
    assert.equal(springCalls.length, 2, "armed momentum settles again on momentum end");
    runWorklet(handlers.onMomentumEnd);
    assert.equal(springCalls.length, 2, "disarmed momentum does not settle again");

    // Programmatic restoration (TOC jump, restore position) must reset drag
    // state and spring the chrome back in, then ignore non-drag scroll events.
    springCalls.length = 0;
    latestApi.expand(240);
    assert.equal(latestApi.hidden.value, 0);
    assert.equal(latestApi.expansion.spatial.value, 1);
    assert.equal(latestApi.expansion.effects.value, 1);
    assert.deepEqual(springCalls.map((call) => call.value), [1, 1, 0]);
    assert.equal(springCalls[2].config.overshootClamping, true);
    assert.equal(springCalls[2].config.stiffness, SPRING_A.stiffness);

    latestApi.hidden.value = 0;
    runWorklet(handlers.onScroll, scrollEvent(200, 500, 300));
    assert.equal(latestApi.hidden.value, 0, "a non-drag scroll after expand does not move the chrome");

    // Pinned selection chrome ignores scroll collapse entirely.
    await view.render(true);
    const pinned = registry.handlers;
    latestApi.hidden.value = 30;
    springCalls.length = 0;
    runWorklet(pinned.onBeginDrag, scrollEvent(0));
    runWorklet(pinned.onScroll, scrollEvent(200, 500, 300));
    assert.equal(latestApi.hidden.value, 30, "pinned chrome stays put");
    assert.equal(springCalls.length, 0, "pinned chrome does not start a collapse spring");
    t.diagnostic("momentum/programmatic/pinned paths preserved");
  } finally {
    await view.unmount();
  }
});
