/** Run with: node --test apps/mobile/scripts/overlay-publish-work.test.cjs
 *
 * Actual-source work counts for the shared overlay host and anchored menus.
 * The real OverlayHost/OverlayPortal/ContextMenu sources run on React DOM in
 * jsdom; only platform leaves (react-native hosts, Reanimated, icons, focus
 * helpers) are stubbed.
 *
 * Guards two audited costs:
 *  - a publisher re-render with unchanged children must not republish the
 *    layer (which re-rendered OverlayLayers and every sibling wrapper);
 *  - a web ContextMenu must measure its body and lock placement inside the
 *    mount task, before the first paint and before its entrance starts,
 *    instead of waiting for a post-paint layout callback.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("../../../node_modules/react");
const { createRoot } = require("../../../node_modules/react-dom/client");
const { JSDOM } = require("../../../node_modules/jsdom");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.requestAnimationFrame = callback => dom.window.requestAnimationFrame(callback);
globalThis.cancelAnimationFrame = id => dom.window.cancelAnimationFrame(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

// jsdom has no layout engine. Every connected element reports the same border
// box; the mounted menu body is therefore a known 320px tall.
const ELEMENT_HEIGHT = 320;
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() { return this.isConnected ? ELEMENT_HEIGHT : 0; },
});
dom.window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { x: 0, y: 0, width: this.isConnected ? 240 : 0, height: this.isConnected ? ELEMENT_HEIGHT : 0,
    top: 0, left: 0, right: this.isConnected ? 240 : 0, bottom: this.isConnected ? ELEMENT_HEIGHT : 0, toJSON() {} };
};
dom.window.Element.prototype.getClientRects = function getClientRects() { return [this.getBoundingClientRect()]; };

/* ------------------------------ react-native stub ----------------------------- */

const flattenStyle = style => {
  if (style == null) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style;
};
const kebab = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const pendingMeasures = [];
let nativeMeasureHeight = ELEMENT_HEIGHT;

function host(tag) {
  return React.forwardRef(function Host({ children, style, dataSet, onLayout, pointerEvents, ...rest }, ref) {
    const attach = React.useCallback(node => {
      // RN Web puts measure() on every host node; native measure is async and
      // is driven by hand below so the readiness gate can be observed.
      if (node && typeof node.measure !== "function") {
        node.measure = callback => { pendingMeasures.push({ node, callback }); };
      }
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }, [ref]);
    const domProps = { ref: attach, "data-teststyle": JSON.stringify(flattenStyle(style)) };
    if (rest.id) domProps.id = rest.id;
    if (rest.role) domProps.role = rest.role;
    if (rest.accessibilityRole) domProps.role = rest.accessibilityRole;
    if (rest.tabIndex != null) domProps.tabIndex = rest.tabIndex;
    if (rest.testID) domProps["data-testid"] = rest.testID;
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("aria-") || key.startsWith("data-")) domProps[key] = value;
    }
    for (const [key, value] of Object.entries(dataSet ?? {})) domProps[`data-${kebab(key)}`] = String(value);
    // Preserve the layout origin the real menu sets inline, so the test can
    // read the post-measurement placement from the DOM.
    const flat = flattenStyle(style);
    if (typeof flat.left === "number" || typeof flat.top === "number") {
      domProps.style = { left: flat.left, top: flat.top, width: flat.width, maxHeight: flat.maxHeight };
    }
    void onLayout; void pointerEvents;
    return React.createElement(tag, domProps, children);
  });
}

const reactNative = {
  Platform: { OS: "web", select: options => options.web ?? options.default },
  View: host("div"),
  Text: host("span"),
  Pressable: host("div"),
  ScrollView: host("div"),
  StyleSheet: {
    create: styles => styles,
    flatten: flattenStyle,
    absoluteFill: {},
    hairlineWidth: 1,
  },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  Keyboard: {
    addListener: () => ({ remove() {} }),
    metrics: () => null,
    dismiss: () => {},
    isVisible: () => false,
  },
  Appearance: { setColorScheme: () => {} },
  I18nManager: { isRTL: false },
  NativeModules: {},
};

/* ------------------------------ reanimated stub ------------------------------- */

const timingCalls = [];
const reanimated = {
  useSharedValue(initial) {
    const slot = React.useRef(null);
    if (slot.current === null) slot.current = { value: initial };
    return slot.current;
  },
  useAnimatedStyle: () => ({}),
  withTiming(value, config, callback) {
    timingCalls.push({ value, config });
    void callback;
    return value;
  },
  withSpring: value => value,
  cancelAnimation: () => {},
  runOnJS: callback => callback,
  interpolate: value => value,
  Easing: { quad: value => value, inOut: fn => fn, in: fn => fn, out: fn => fn, bezier: () => value => value, linear: value => value },
};
reanimated.default = { View: reactNative.View, createAnimatedComponent: component => component, ...reanimated };
Object.defineProperty(reanimated, "__esModule", { value: true });

/* --------------------------------- stubs ------------------------------------- */

const palette = new Proxy({}, { get: (_target, key) => `#${String(key)}` });
const themeState = { palette, shadows: { level2: {} }, expressive: false };
const motion = { reducedMotion: false, spatial: { stiffness: 700 }, expressive: false };

const stubs = new Map();
const modules = new Map();
const bareStubs = {
  "react": React,
  "react-native": reactNative,
  "react-native-reanimated": reanimated,
  "react-native-safe-area-context": {
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  },
  "react-native-gesture-handler": { Gesture: {}, GestureDetector: ({ children }) => children, Pressable: reactNative.Pressable },
};

function stub(relative, exports_) { stubs.set(resolve(sourceRoot, relative), exports_); }

stub("theme/ThemeProvider.tsx", {
  useTheme: () => themeState,
  ThemeOverrideProvider: ({ children }) => children,
});
stub("theme/material-motion.ts", { useMaterialMotion: () => motion, materialMotion: {} });
stub("hooks/use-keyboard-visible.ts", {
  dismissKeyboard: () => {},
  keyboardIsOpen: () => false,
  useKeyboardViewportHeight: height => height,
});
stub("hooks/use-overlay-focus.ts", { useOverlayFocus: () => React.useRef(null) });
stub("lib/menu-outside-scroll.ts", { listenForMenuOutsideScroll: () => () => {} });
stub("lib/haptics.ts", { haptics: { light: () => {}, medium: () => {}, heavy: () => {} } });
stub("components/ui/PressableScale.tsx", {
  PressableScale: React.forwardRef(function PressableScaleStub({ children, ...rest }, ref) {
    void rest;
    return React.createElement("div", { ref }, children);
  }),
});
stub("components/ui/MaterialIcon.tsx", {
  MaterialIcon: () => React.createElement("span"),
  materialIconName: name => name,
});
stub("components/ui/PinIcon.tsx", {
  AppIcon: () => React.createElement("span"),
  PinIcon: () => React.createElement("span"),
});
stub("components/ui/Spinner.tsx", { Spinner: () => React.createElement("span") });
stub("components/ui/Text.tsx", {
  Text: ({ children }) => React.createElement("span", null, children),
});
stub("components/ui/ThemedScrollView.tsx", {
  ThemedScrollView: React.forwardRef(function ThemedScrollViewStub({ children }, ref) {
    return React.createElement("div", { ref }, children);
  }),
});

// Track registry listener wakeups: each notify re-renders OverlayLayers and
// OverlayBackground for a layer already on screen.
const registryModule = resolve(sourceRoot, "lib/overlay-registry.ts");
function loadRaw(filename) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  new Function("require", "module", "exports", outputText)(require, module, module.exports);
  return module.exports;
}
const realRegistry = loadRaw(registryModule);
const registryWork = { notifications: 0, publishes: 0, api: null };
stubs.set(registryModule, {
  topBlockingLayer: realRegistry.topBlockingLayer,
  createOverlayRegistry() {
    const api = realRegistry.createOverlayRegistry();
    registryWork.api = api;
    const subscribe = api.subscribe;
    const upsert = api.upsert;
    api.subscribe = listener => subscribe(() => { registryWork.notifications += 1; listener(); });
    api.upsert = (...args) => {
      const before = api.getLayers();
      const result = upsert(...args);
      if (api.getLayers() !== before) registryWork.publishes += 1;
      return result;
    };
    return api;
  },
});

/* --------------------------- transpiled source loader ------------------------- */

function resolveLocal(from, name) {
  for (const candidate of [name, `${name}.tsx`, `${name}.ts`, `${name}/index.ts`]) {
    const path = resolve(from, candidate);
    try { readFileSync(path); return path; } catch {}
  }
  throw new Error(`Cannot resolve ${name} from ${from}`);
}
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  if (stubs.has(filename)) return stubs.get(filename);
  const module = { exports: {} };
  modules.set(filename, module);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const localRequire = name => {
    if (bareStubs[name]) return bareStubs[name];
    if (name.startsWith(".")) {
      const path = resolveLocal(dirname(filename), name);
      return stubs.has(path) ? stubs.get(path) : load(path);
    }
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

const overlayHostPath = resolve(sourceRoot, "components/ui/overlay-host.tsx");
const contextMenuPath = resolve(sourceRoot, "components/ui/ContextMenu.tsx");
const { OverlayHost, OverlayPortal } = load(overlayHostPath);
const { ContextMenu } = load(contextMenuPath);

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root, render: async next => { await act(async () => { root.render(next); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
function resetWork() {
  registryWork.notifications = 0;
  registryWork.publishes = 0;
  timingCalls.length = 0;
  pendingMeasures.length = 0;
}

/* ---------------------------------- tests ------------------------------------ */

test("publisher re-render with unchanged portal children does not republish the layer", async t => {
  resetWork();
  const layerRenders = { count: 0 };
  const stableChild = React.createElement(function LayerChild() {
    layerRenders.count += 1;
    return React.createElement("span", null, "stable layer");
  });
  let bump;
  function Publisher() {
    const [count, setCount] = React.useState(0);
    bump = setCount;
    return React.createElement(React.Fragment, null,
      React.createElement("button", { id: "bump", onClick: () => setCount(value => value + 1) }, `bump ${count}`),
      React.createElement(OverlayPortal, { blocking: true }, stableChild));
  }
  const tree = mount();
  await tree.render(React.createElement(OverlayHost, null, React.createElement(Publisher)));
  assert.equal(registryWork.publishes, 1, "the first publication registers the layer");
  const mountedNotifications = registryWork.notifications;
  const mountedRenders = layerRenders.count;

  await act(async () => { bump(value => value + 1); });
  await act(async () => { bump(value => value + 1); });
  const rerenderWork = {
    publishes: registryWork.publishes,
    notify: registryWork.notifications - mountedNotifications,
    layerRenders: layerRenders.count - mountedRenders,
  };
  assert.deepEqual(rerenderWork, { publishes: 1, notify: 0, layerRenders: 0 },
    "two parent commits with unchanged children must not upsert, notify, or rerender the layer");
  t.diagnostic(`two parent commits with stable children: publishes=${rerenderWork.publishes}, notify=${rerenderWork.notify}, layerRenders=${rerenderWork.layerRenders}`);

  await tree.unmount();
  assert.equal(registryWork.api.getLayers().length, 0, "unmount still withdraws the layer");
});

test("changed blocking/active flags and new children still publish", async () => {
  resetWork();
  let setVariant;
  function Publisher() {
    const [variant, set] = React.useState("a");
    setVariant = set;
    return React.createElement(OverlayPortal, { blocking: variant !== "b", active: variant !== "c" },
      React.createElement("span", null, variant));
  }
  const tree = mount();
  await tree.render(React.createElement(OverlayHost, null, React.createElement(Publisher)));
  const afterMount = registryWork.publishes;
  assert.equal(afterMount, 1);

  await act(async () => { setVariant("b"); });
  assert.equal(registryWork.publishes, afterMount + 1, "blocking change republishes");
  await act(async () => { setVariant("c"); });
  assert.equal(registryWork.publishes, afterMount + 2, "active change and new children republish");
  await tree.unmount();
});

test("web ContextMenu measures and places its body during the mount task", async t => {
  resetWork();
  const events = { commits: 0, entranceStarted: 0 };
  const anchor = { x: 20, y: 700, width: 40, height: 40 };
  let setVisible;
  function Harness() {
    const [visible, set] = React.useState(true);
    setVisible = set;
    return React.createElement(ContextMenu, { visible, onDismiss: () => {}, anchor },
      React.createElement("span", null, "menu body content"));
  }
  const tree = mount();
  await tree.render(React.createElement(React.Profiler, { id: "overlay", onRender: () => { events.commits += 1; } },
    React.createElement(OverlayHost, null, React.createElement(Harness))));

  // The entrance is a withTiming(1) started by useOverlayPresence. It must be
  // running in the mount task: no ResizeObserver/measure timeout may gate it.
  events.entranceStarted = timingCalls.filter(call => call.value === 1).length;
  const menu = tree.container.querySelector('[role="menu"]');
  assert.ok(menu, "the menu is mounted in the overlay host");
  const style = JSON.parse(menu.getAttribute("data-teststyle"));
  // placeMenu above the trigger: 700 - 6 - (measured 320 + padding 16) = 358.
  // The 200px estimate would have placed it at 478. The measured height also
  // republishes the corrected origin, still inside this pre-paint settle.
  assert.deepEqual({
    entranceStarted: events.entranceStarted,
    top: style.top,
    publishes: registryWork.publishes,
    commits: events.commits,
  }, { entranceStarted: 1, top: 358, publishes: 2, commits: 4 },
  "the web menu must measure, place, and start its entrance in the mount task");
  t.diagnostic(`mount settle: commits=${events.commits}, entranceStarts=${events.entranceStarted}, menuTop=${style.top}, publishes=${registryWork.publishes}`);

  // Exit still retains the surface for the fade.
  await act(async () => { setVisible(false); });
  assert.ok(tree.container.querySelector('[role="menu"]'), "the menu stays mounted through its exit");
  await tree.unmount();
});

test("native ContextMenu keeps its entrance gated on the async body measurement", async t => {
  resetWork();
  reactNative.Platform.OS = "android";
  try {
    const anchor = { x: 20, y: 700, width: 40, height: 40 };
    function Harness() {
      return React.createElement(ContextMenu, { visible: true, onDismiss: () => {}, anchor },
        React.createElement("span", null, "menu body content"));
    }
    const tree = mount();
    await tree.render(React.createElement(OverlayHost, null, React.createElement(Harness)));
    assert.equal(timingCalls.filter(call => call.value === 1).length, 0,
      "native must not start its entrance before layout reports a height");
    const measure = pendingMeasures.at(-1);
    assert.ok(measure, "the menu body asks native for its size at mount");
    await act(async () => { measure.callback(0, 0, 240, nativeMeasureHeight); });
    assert.equal(timingCalls.filter(call => call.value === 1).length, 1,
      "the entrance starts once native reports the measured body");
    const style = JSON.parse(tree.container.querySelector('[role="menu"]').getAttribute("data-teststyle"));
    assert.equal(style.top, 358, "native placement uses the reported height");
    t.diagnostic(`native mount: entranceStarts=${timingCalls.filter(call => call.value === 1).length}, menuTop=${style.top}, measures=${pendingMeasures.length}`);
    await tree.unmount();
  } finally {
    reactNative.Platform.OS = "web";
  }
});
