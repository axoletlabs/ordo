/** Real-React regression cover for the shared segmented control:
 *   - stable option/label props bail out of repainting unchanged segments and
 *     the hidden measuring row;
 *   - a selection change repaints only the two options whose state changed;
 *   - the per-label measuring callbacks commit as one state update at the
 *     microtask checkpoint, so a five-option group does not render five extra
 *     times on first mount and adds no timer boundary;
 *   - a discarded transition/Suspense render cannot publish a speculative
 *     value or onChange closure to the next press.
 * The components under test are the real source files with only platform
 * primitives mocked. Run with:
 *   node --test apps/mobile/scripts/segmented-render-work.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");
const { JSDOM } = require("jsdom");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const counters = { labels: 0, measures: 0, groupRenders: 0 };
const layouts = { outer: null, measures: [] };
const PALETTE = Object.fromEntries([
  "onSurface", "onSurfaceVariant", "primary", "onPrimary", "onPrimaryContainer", "secondary", "secondaryContainer",
  "onSecondary", "onSecondaryContainer", "error", "onError", "outline", "outlineVariant", "surface",
  "surfaceContainer", "surfaceContainerLow", "surfaceContainerHighest", "surfaceContainerHigh", "background",
].map(role => [role, "#123456"]));
const MOTION_FAST = { id: "effects.fast" };
const MOTION = Object.freeze({ fast: { id: "standard.fast" }, expressive: false, reducedMotion: false });

function styleEntries(style) {
  return (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(entry => entry && typeof entry === "object");
}
function flatStyle(style) {
  return Object.assign({}, ...styleEntries(style));
}

function element(type, props, ...children) {
  return React.createElement(type, props, ...children);
}

const View = React.forwardRef(function View(props, _ref) {
  const flat = flatStyle(props.style);
  if (props.accessibilityRole === "radiogroup") counters.groupRenders++;
  if (!Array.isArray(props.style) && flat.minHeight === 48) layouts.outer = props.onLayout ?? null;
  return element("div", { "data-testid": props.testID, "data-flex": flat.flexDirection, role: props.accessibilityRole }, props.children);
});
const Text = React.forwardRef(function Text(props, _ref) {
  if (props.onLayout) { counters.measures++; layouts.measures.push(props.onLayout); }
  if (props.testID === "material-segment-label") counters.labels++;
  return element("span", { "data-testid": props.testID }, props.children);
});
function Pressable(props) {
  const children = typeof props.children === "function"
    ? props.children({ pressed: false, hovered: false, focused: false }) : props.children;
  return element("div", {
    "data-testid": props.testID,
    role: props.accessibilityRole,
    "aria-checked": props.accessibilityState?.checked,
    "aria-disabled": props.disabled,
    tabIndex: props.tabIndex,
    // Real Pressables dispatch onPress; concurrent tests click a committed
    // segment after a discarded render.
    onClick: props.disabled ? undefined : props.onPress,
  }, children);
}

function reanimatedMock() {
  const Animated = {
    createAnimatedComponent: component => component,
    View,
  };
  return {
    useSharedValue: value => React.useRef({ value }).current,
    useAnimatedStyle: () => ({}),
    useAnimatedProps: () => ({}),
    withSpring: value => value,
    withTiming: value => value,
    interpolateColor: (_value, _input, output) => output[0],
    cancelAnimation: () => {},
    Animated,
    Easing: { linear: value => value, bezier: () => value => value },
    ReduceMotion: { Never: "never" },
    default: { Animated, createAnimatedComponent: component => component, View },
  };
}

const modules = new Map();
function mockFor(filename) {
  const base = filename.slice(sourceRoot.length);
  if (base === "/components/ui/Text.tsx") return { Text };
  if (base === "/components/ui/MaterialIcon.tsx") return { MaterialIcon: Object.assign(() => null, { glyphMap: {} }) };
  if (base === "/components/ui/StateLayer.tsx") return { StateLayer: () => null };
  if (base === "/theme/ThemeProvider.tsx") return {
    useTheme: () => ({ palette: PALETTE, expressive: false, shadows: {} }),
  };
  if (base === "/theme/material-motion.ts") return {
    materialMotion: { effects: { fast: MOTION_FAST } },
    useMaterialMotion: () => MOTION,
  };
  if (base === "/theme/tokens.ts") return {
    radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, full: 9999 },
    spacing: new Proxy({}, { get: () => 8 }),
    fontSize: { md: 16 },
    resolveFont: () => undefined,
    layout: {},
  };
  if (base === "/lib/haptics.ts") return { haptics: { selection() {}, light() {}, warning() {} } };
  if (base === "/components/ui/pressable-web.ts") return { webSelectionKeys: () => ({}) };
  if (base === "/lib/pointer-hover.ts") return { nativeHoverEvents: () => ({}) };
  if (base === "/theme/scrollbar.ts") return {};
  return undefined;
}

function resolveModule(from, name) {
  for (const candidate of [name, `${name}.tsx`, `${name}.ts`, `${name}/index.tsx`, `${name}/index.ts`]) {
    const path = resolve(from, candidate);
    try { readFileSync(path); return path; } catch {}
  }
  throw new Error(`Cannot resolve ${name} from ${from}`);
}

function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const mock = mockFor(filename);
  if (mock) { modules.set(filename, { exports: mock }); return mock; }
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const mod = { exports: {} };
  modules.set(filename, mod);
  const platform = {
    OS: "web",
    select: choices => choices.web ?? choices.default ?? choices.android,
  };
  const localRequire = name => {
    // React's CJS entry has no `default`; give the transpiled default import
    // the same object while keeping the real hook dispatcher.
    if (name === "react") return Object.assign({ default: React }, React);
    if (name === "react/jsx-runtime") return require("react/jsx-runtime");
    if (name === "react-native") return {
      Platform: platform, View, Pressable, TextInput: "input", AppState: { currentState: "active" },
      StyleSheet: {
        create: value => value,
        flatten: style => (Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(entry => entry && typeof entry === "object")) : style ?? undefined),
        hairlineWidth: 1, absoluteFill: {},
      },
      Animated: { View, createAnimatedComponent: component => component, Value: class {}, spring: () => ({ start() {}, stop() {} }) },
      useWindowDimensions: () => ({ width: 800, height: 600, fontScale: 1 }),
    };
    if (name === "react-native-reanimated") return reanimatedMock();
    if (name === "react-native-gesture-handler") return { Pressable };
    if (name.startsWith(".")) return load(resolveModule(dirname(filename), name));
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
  return mod.exports;
}

const ui = name => load(resolve(sourceRoot, "components/ui", name));
const OPTIONS = [
  { value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" },
  { value: "d", label: "Delta" }, { value: "e", label: "Epsilon" },
];

function setup() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  counters.labels = 0; counters.measures = 0; counters.groupRenders = 0;
  layouts.outer = null; layouts.measures.length = 0;
  return {
    root,
    async render(props) {
      const Segmented = ui("Segmented.tsx").Segmented;
      await React.act(() => root.render(element(Segmented, props)));
    },
    async unmount() {
      await React.act(() => root.unmount());
      dom.window.close();
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    },
  };
}

const options = { options: OPTIONS, value: "a", onChange: () => {} };

for (const orientation of ["horizontal", "vertical"]) {
  test(`Explicit ${orientation} segments do not observe unused container widths`, async () => {
    const host = setup();
    try {
      await host.render({ ...options, orientation });
      assert.equal(layouts.outer, null, "a fixed orientation needs no layout observer or width state update");
      assert.equal(counters.measures, 0);
      assert.equal(counters.groupRenders, 1);
      assert.equal(document.querySelector('[role="radiogroup"]').getAttribute("data-flex"), orientation === "vertical" ? "column" : "row");
    } finally { await host.unmount(); }
  });
}

test("Auto/fixed orientation changes retain controls and ignore queued obsolete measurements", async () => {
  const host = setup();
  try {
    await host.render({ ...options });
    const previousLayout = layouts.outer;
    const radios = [...document.querySelectorAll('[role="radio"]')];
    await host.render({ ...options, orientation: "vertical" });
    assert.equal(layouts.outer, null);
    const renders = counters.groupRenders;
    await React.act(() => previousLayout({ nativeEvent: { layout: { width: 5 } } }));
    assert.equal(counters.groupRenders, renders, "a queued auto layout cannot update a now-fixed group");
    assert.deepEqual([...document.querySelectorAll('[role="radio"]')], radios);
    await host.render({ ...options });
    assert.ok(layouts.outer, "auto orientation resumes real measurement");
    await React.act(() => layouts.outer({ nativeEvent: { layout: { width: 100 } } }));
    assert.equal(document.querySelector('[role="radiogroup"]').getAttribute("data-flex"), "column");
    await React.act(() => layouts.outer({ nativeEvent: { layout: { width: 800 } } }));
    assert.equal(document.querySelector('[role="radiogroup"]').getAttribute("data-flex"), "row");
    assert.deepEqual([...document.querySelectorAll('[role="radio"]')], radios);
  } finally { await host.unmount(); }
});

test("Stable segment props skip unchanged segments, labels, and measurements", async () => {
  const host = setup();
  try {
    await host.render({ ...options });
    assert.equal(counters.labels, 5, "each option mounts one visible label");
    assert.equal(counters.measures, 5, "auto orientation mounts one hidden measurement per label");
    assert.equal(counters.groupRenders, 1);
    // A parent rerender with a fresh inline callback must not repaint children.
    await host.render({ ...options, onChange: () => {} });
    assert.equal(counters.labels, 5, "unchanged labels stay memoized across parent renders");
    assert.equal(counters.measures, 5, "the measuring row is not rebuilt");
    // Callers such as menus build their options inline. Equal fields must bail
    // even though the array/object identities changed.
    await host.render({ ...options, options: OPTIONS.map(option => ({ ...option })), onChange: () => {} });
    assert.equal(counters.labels, 5, "inline option objects with equal fields don't repaint labels");
    assert.equal(counters.measures, 5, "the hidden row compares option fields, not array identity");
    // Only the old and new selected segments, and their labels, repaint.
    await host.render({ ...options, value: "b" });
    assert.equal(counters.labels, 7, "selection repaints exactly the two changed labels");
    assert.equal(counters.measures, 5);
    await host.render({ ...options, value: "b", onChange: () => {} });
    assert.equal(counters.labels, 7);
    assert.equal(counters.measures, 5);
  } finally { await host.unmount(); }
});

test("Per-label measurements commit as one microtask render instead of one per label", async () => {
  const host = setup();
  try {
    await host.render({ ...options });
    assert.ok(layouts.outer, "the outer group exposes its layout callback");
    await React.act(() => layouts.outer({ nativeEvent: { layout: { width: 200 } } }));
    assert.equal(counters.groupRenders, 2, "the container width commit is one render");
    const measures = layouts.measures.slice();
    assert.equal(measures.length, 5);
    let macrotaskRan = false;
    const macrotask = setTimeout(() => { macrotaskRan = true; }, 0);
    const originalQueueMicrotask = globalThis.queueMicrotask;
    let microtasksQueued = 0;
    let microtasksRun = 0;
    globalThis.queueMicrotask = (callback) => {
      microtasksQueued += 1;
      originalQueueMicrotask(() => { microtasksRun += 1; callback(); });
    };
    try {
      // Native layout callbacks can arrive outside React's event batching, so
      // force a synchronous commit attempt after each one. The batched
      // implementation only records widths; it must not render until the
      // microtask checkpoint, but it must render before the next macrotask.
      let rendersDuringDispatch = 0;
      await React.act(async () => {
        for (const measure of measures) {
          flushSync(() => measure({ nativeEvent: { layout: { width: 80 } } }));
          rendersDuringDispatch = Math.max(rendersDuringDispatch, counters.groupRenders);
        }
        assert.equal(microtasksQueued, 1, "five measurements coalesce into one microtask");
        await Promise.resolve();
        assert.equal(microtasksRun, 1, "the coalesced flush runs at the microtask checkpoint");
        assert.equal(macrotaskRan, false, "no timer/macrotask is needed for the width commit");
      });
      assert.equal(rendersDuringDispatch, 2, "five layout callbacks do not render the group five times");
      assert.equal(counters.groupRenders, 3, "the whole measuring pass commits once");
    } finally {
      globalThis.queueMicrotask = originalQueueMicrotask;
      clearTimeout(macrotask);
    }
    const group = document.querySelector('[role="radiogroup"]');
    assert.equal(group.getAttribute("data-flex"), "column", "the batched widths still stack the narrow group");
    // Re-reporting the same widths is a no-op, including the microtask flush.
    await React.act(async () => {
      for (const measure of measures) measure({ nativeEvent: { layout: { width: 80 } } });
      await Promise.resolve();
    });
    assert.equal(counters.groupRenders, 3, "unchanged measurements skip the state commit");
  } finally { await host.unmount(); }
});

test("A width-driven auto orientation changes before the next macrotask", async () => {
  const host = setup();
  try {
    await host.render({ ...options });
    // Empty-width heuristic fits five short labels in 300px; measured 80px
    // labels (plus check and padding) do not.
    await React.act(() => layouts.outer({ nativeEvent: { layout: { width: 300 } } }));
    assert.equal(document.querySelector('[role="radiogroup"]').getAttribute("data-flex"), "row");
    const measures = layouts.measures.slice();
    let macrotaskRan = false;
    const macrotask = setTimeout(() => { macrotaskRan = true; }, 0);
    const originalQueueMicrotask = globalThis.queueMicrotask;
    let microtasksQueued = 0;
    let microtasksRun = 0;
    globalThis.queueMicrotask = (callback) => {
      microtasksQueued += 1;
      originalQueueMicrotask(() => { microtasksRun += 1; callback(); });
    };
    try {
      await React.act(async () => {
        for (const measure of measures) flushSync(() => measure({ nativeEvent: { layout: { width: 80 } } }));
        assert.equal(document.querySelector('[role="radiogroup"]').getAttribute("data-flex"), "row",
          "the layout dispatch itself still records widths instead of rendering");
        assert.equal(microtasksQueued, 1, "the layout callbacks coalesce into one microtask");
        await Promise.resolve();
        assert.equal(microtasksRun, 1, "the coalesced flush runs before any macrotask/paint");
        assert.equal(macrotaskRan, false, "no timer/macrotask was needed for the width commit");
      });
      assert.equal(document.querySelector('[role="radiogroup"]').getAttribute("data-flex"), "column",
        "the measured widths commit in the same microtask checkpoint");
    } finally {
      globalThis.queueMicrotask = originalQueueMicrotask;
      clearTimeout(macrotask);
    }
  } finally { await host.unmount(); }
});

/* ---------------------- concurrent render / Suspense repro ---------------------- */

/**
 * Both tests let React start a transition that renders Segmented with new
 * props, then suspend a later sibling so the whole pass is discarded. The
 * committed tree keeps the previous props. The next press must use those
 * committed props, not the discarded render's value/onChange.
 */
async function discardedRenderHarness(App) {
  const host = setup();
  await React.act(() => host.root.render(element(App)));
  return host;
}

test("A discarded transition render cannot swallow the next segment press", async () => {
  const Segmented = ui("Segmented.tsx").Segmented;
  const suspension = { armed: false, promise: null };
  function Suspender() {
    if (!suspension.armed) return null;
    if (!suspension.promise) {
      // The boundary is unmounted before this resolves. Keeping it pending
      // avoids resolving suspended data outside act(), which would only warn.
      suspension.promise = new Promise(() => {});
    }
    throw suspension.promise;
  }
  const clicked = [];
  let startDiscardedPass;
  function App() {
    const [value, setValue] = React.useState("a");
    const [pending, setPending] = React.useState(false);
    suspension.armed = pending;
    startDiscardedPass = () => {
      React.startTransition(() => { setValue("b"); setPending(true); });
    };
    return element(React.Suspense, { fallback: element("div", null, "loading") },
      element(Segmented, {
        options: OPTIONS,
        value,
        onChange: (next) => { clicked.push(next); setValue(next); },
      }),
      element(Suspender, null));
  }
  const host = await discardedRenderHarness(App);
  try {
    assert.equal(document.querySelectorAll('[role="radio"]').length, 5);
    await React.act(async () => {
      startDiscardedPass();
      // Let the transition render run and suspend; React keeps the current
      // tree because the update is not urgent.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const checked = [...document.querySelectorAll('[role="radio"]')]
      .find((node) => node.getAttribute("aria-checked") === "true");
    assert.match(checked?.textContent ?? "", /Alpha/, "the committed tree still shows the old selection");
    // Drop the suspension before the press, so the press's urgent render is
    // observable instead of React showing the boundary fallback.
    suspension.armed = false;
    const beta = [...document.querySelectorAll('[role="radio"]')]
      .find((node) => node.textContent?.includes("Beta"));
    assert.ok(beta, "Beta is present in the committed tree");
    await React.act(() => beta.click());
    assert.deepEqual(clicked, ["b"], "the press must reach onChange, not be swallowed as already-selected");
  } finally {
    await host.unmount();
  }
});

test("A discarded render cannot install its callback closure", async () => {
  const Segmented = ui("Segmented.tsx").Segmented;
  const suspension = { armed: false, promise: null };
  function Suspender() {
    if (!suspension.armed) return null;
    if (!suspension.promise) {
      // The boundary is unmounted before this resolves. Keeping it pending
      // avoids resolving suspended data outside act(), which would only warn.
      suspension.promise = new Promise(() => {});
    }
    throw suspension.promise;
  }
  const seen = [];
  let startDiscardedPass;
  function App() {
    const [value, setValue] = React.useState("a");
    const [version, setVersion] = React.useState("committed");
    const [pending, setPending] = React.useState(false);
    suspension.armed = pending;
    startDiscardedPass = () => {
      // Segmented's value is unchanged; only the callback closure this render
      // would publish is speculative.
      React.startTransition(() => { setVersion("speculative"); setPending(true); });
    };
    return element(React.Suspense, { fallback: element("div", null, "loading") },
      element(Segmented, {
        options: OPTIONS,
        value,
        onChange: (next) => { seen.push(version); setValue(next); },
      }),
      element(Suspender, null));
  }
  const host = await discardedRenderHarness(App);
  try {
    await React.act(async () => {
      startDiscardedPass();
      // Let the transition render run and suspend; React keeps the current
      // tree because the update is not urgent.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    suspension.armed = false;
    const beta = [...document.querySelectorAll('[role="radio"]')]
      .find((node) => node.textContent?.includes("Beta"));
    assert.ok(beta, "Beta is present in the committed tree");
    await React.act(() => beta.click());
    assert.deepEqual(seen, ["committed"], "the press must use the committed onChange closure");
  } finally {
    await host.unmount();
  }
});
