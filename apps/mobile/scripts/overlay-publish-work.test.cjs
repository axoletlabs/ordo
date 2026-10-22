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
 *  - a web ContextMenu must not read `offsetHeight` inside the commit. That
 *    forced a synchronous document style/layout flush (dominant cost behind the
 *    reader); the body measures from the regular layout report instead and the
 *    entrance stays gated until the corrected placement is committed.
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
let dialogLayout;
const layoutHandlers = new Map();

function host(tag) {
  return React.forwardRef(function Host({ children, style, dataSet, onLayout, pointerEvents, ...rest }, ref) {
    if (rest.role === "dialog") dialogLayout = onLayout;
    const attach = React.useCallback(node => {
      if (node && onLayout) layoutHandlers.set(node, onLayout);
      // RN Web puts measure() on every host node; native measure is async and
      // is driven by hand below so the readiness gate can be observed.
      if (node && typeof node.measure !== "function") {
        node.measure = callback => { pendingMeasures.push({ node, callback }); };
      }
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }, [ref]);
    const domProps = { ref: attach, "data-teststyle": JSON.stringify(flattenStyle(style)) };
    domProps["data-native-pointer-events"] = pointerEvents ?? "unset";
    domProps["data-native-accessibility-hidden"] = String(rest.accessibilityElementsHidden ?? false);
    domProps["data-native-accessibility-importance"] = rest.importantForAccessibility ?? "auto";
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
    void onLayout;
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
  Easing: { quad: value => value * value, cubic: value => value ** 3,
    inOut: fn => value => value < 0.5 ? fn(value * 2) / 2 : 1 - fn((1 - value) * 2) / 2,
    in: fn => fn, out: fn => value => 1 - fn(1 - value), bezier: () => value => value, linear: value => value },
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
stub("components/ui/PanelHeader.tsx", { PanelHeader: ({ children }) => children ?? null });
stub("components/ui/SheetActionRow.tsx", { PanelActions: ({ children }) => children ?? null });
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

test("background isolation never toggles inherited web pointer-events and keeps native hit testing", async t => {
  for (const platform of ["web", "android"]) {
    await t.test(platform, async () => {
      reactNative.Platform.OS = platform;
      const tree = mount();
      const render = (parent, child = false) => tree.render(React.createElement(OverlayHost, null,
        React.createElement("button", { id: "background-action" }, "Library"),
        parent ? React.createElement(OverlayPortal, null, React.createElement("div", { role: "dialog", id: "parent-surface" }, "Save")) : null,
        child ? React.createElement(OverlayPortal, null, React.createElement("div", { role: "menu", id: "child-surface" }, "Folders")) : null));
      try {
        await render(false);
        const background = tree.container.querySelector("#background-action").parentElement;
        const pointer = () => background.getAttribute("data-native-pointer-events");
        assert.equal(pointer(), platform === "web" ? "unset" : "auto");
        await render(true);
        assert.equal(pointer(), platform === "web" ? "unset" : "none");
        assert.equal(background.getAttribute("data-native-accessibility-hidden"), "true");
        assert.equal(background.getAttribute("data-native-accessibility-importance"), "no-hide-descendants");
        if (platform === "web") {
          assert.equal(background.inert, true, "real modal isolation still blocks background interaction");
          assert.equal(background.getAttribute("aria-hidden"), "true");
          assert.equal(document.body.style.overflow, "hidden");
        }
        await render(true, true);
        assert.equal(pointer(), platform === "web" ? "unset" : "none");
        if (platform === "web") {
          assert.equal(background.inert, true);
          assert.equal(tree.container.querySelector("#parent-surface").closest("[data-overlay-layer]").inert, true,
            "only the child surface is interactive");
        }
        await render(true);
        if (platform === "web") assert.equal(background.inert, true, "child dismissal does not release the background");
        await render(false);
        assert.equal(pointer(), platform === "web" ? "unset" : "auto");
        assert.equal(background.getAttribute("data-native-accessibility-hidden"), "false");
        if (platform === "web") {
          assert.ok(!background.inert);
          assert.equal(background.getAttribute("aria-hidden"), null);
          assert.equal(document.body.style.overflow, "");
        }
      } finally {
        await tree.unmount();
        reactNative.Platform.OS = "web";
      }
    });
  }
});

test("overlay handoffs retain shared background isolation without attribute or scroll-lock churn", async () => {
  const tree = mount();
  const render = (parent, child) => tree.render(React.createElement(OverlayHost, null,
    React.createElement("button", { id: "handoff-background" }, "Library"),
    parent ? React.createElement(OverlayPortal, null, React.createElement("div", { id: "handoff-parent" }, "Save")) : null,
    child ? React.createElement(OverlayPortal, null, React.createElement("div", { id: "handoff-child" }, "Folders")) : null));
  let observer;
  try {
    await render(true, false);
    const background = tree.container.querySelector("#handoff-background").parentElement;
    const changes = [];
    observer = new dom.window.MutationObserver(records => changes.push(...records));
    observer.observe(background, { attributes: true, attributeFilter: ["inert", "aria-hidden"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    await render(true, true);
    assert.equal(background.inert, true);
    assert.equal(tree.container.querySelector("#handoff-parent").closest("[data-overlay-layer]").inert, true);
    await render(true, false);
    assert.equal(background.inert, true);
    assert.ok(!tree.container.querySelector("#handoff-parent").closest("[data-overlay-layer]").inert);
    await render(false, true);
    assert.equal(background.inert, true, "a replacing sibling also keeps the background locked");
    assert.equal(changes.length, 0, "shared background and scroll roots must not be rewritten during handoffs");
    observer.disconnect();
    await render(false, false);
    assert.ok(!background.inert);
    assert.equal(background.getAttribute("aria-hidden"), null);
    assert.equal(document.body.style.overflow, "");
  } finally {
    observer?.disconnect();
    await tree.unmount();
    assert.equal(document.documentElement.style.overflow, "", "unmount releases every acquired lock");
  }
});

test("strict-effect replay and active unmount restore the original document locks", async () => {
  const tree = mount();
  const previousHtml = document.documentElement.style.overflow;
  const previousBody = document.body.style.overflow;
  document.documentElement.style.overflow = "clip";
  document.body.style.overflow = "scroll";
  try {
    const render = child => tree.render(React.createElement(React.StrictMode, null,
      React.createElement(OverlayHost, null,
        React.createElement("button", null, "Library"),
        React.createElement(OverlayPortal, null, React.createElement("div", { id: "strict-parent" }, "Save")),
        child ? React.createElement(OverlayPortal, null, React.createElement("div", { id: "strict-child" }, "Folders")) : null)));
    await render(false);
    assert.equal(document.body.style.overflow, "hidden");
    await render(true);
    assert.equal(document.body.style.overflow, "hidden");
    assert.equal(tree.container.querySelector("#strict-parent").closest("[data-overlay-layer]").inert, true);
    assert.ok(!tree.container.querySelector("#strict-child").closest("[data-overlay-layer]").inert);
    await tree.unmount();
    assert.equal(document.documentElement.style.overflow, "clip");
    assert.equal(document.body.style.overflow, "scroll");
  } finally {
    if (tree.container.isConnected) await tree.unmount();
    document.documentElement.style.overflow = previousHtml;
    document.body.style.overflow = previousBody;
  }
});

test("overlay handoffs retain document locks owned by an independent modal", async () => {
  const tree = mount();
  const { isolateModal } = load(resolve(sourceRoot, "lib/modal-isolation.ts"));
  let release;
  try {
    const render = child => tree.render(React.createElement(OverlayHost, null,
      React.createElement("button", { id: "co-owned-background" }, "Library"),
      React.createElement(OverlayPortal, null, React.createElement("div", { id: "co-owned-parent" }, "Save")),
      child ? React.createElement(OverlayPortal, null, React.createElement("div", null, "Folders")) : null));
    await render(false);
    release = isolateModal(tree.container.querySelector("#co-owned-parent"));
    await render(true);
    await render(false);
    await tree.unmount();
    assert.equal(document.body.style.overflow, "hidden", "host unmount must not release the independent owner");
    release();
    release = undefined;
    assert.equal(document.body.style.overflow, "");
  } finally {
    release?.();
    if (tree.container.isConnected) await tree.unmount();
  }
});

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

test("a warm panel opening does not commit its contents twice to arm exit retention", async t => {
  const { FloatingPanel } = load(resolve(sourceRoot, "components/ui/FloatingPanel.tsx"));
  const tree = mount();
  let commits = 0;
  let childRenders = 0;
  function Content() { childRenders++; return React.createElement("span", null, "Panel content"); }
  const render = visible => tree.render(React.createElement(React.Profiler,
    { id: "warm-panel", onRender: () => commits++ },
    React.createElement(FloatingPanel, { visible, onDismiss() {} }, React.createElement(Content))));
  const reduced = motion.reducedMotion;
  motion.reducedMotion = true;
  try {
    await render(true);
    await render(false);
    commits = 0;
    childRenders = 0;
    await render(true);
    t.diagnostic(`warm open: commits=${commits}, childRenders=${childRenders}`);
    assert.equal(commits, 1, "exit retention must be armed before committing the opening tree");
    assert.equal(childRenders, 1, "opening content is mounted only once");
  } finally {
    await tree.unmount();
    motion.reducedMotion = reduced;
  }
});

test("an abandoned warm opening cannot retain an invisible panel or start its animation", async () => {
  const { FloatingPanel } = load(resolve(sourceRoot, "components/ui/FloatingPanel.tsx"));
  const tree = mount();
  const reduced = motion.reducedMotion;
  motion.reducedMotion = true;
  const pending = new Promise(() => {});
  function Suspend({ active }) { if (active) throw pending; return null; }
  const scene = (visible, suspend = false) => React.createElement(React.Suspense, { fallback: "pending" },
    React.createElement(FloatingPanel, { visible, onDismiss() {} }, React.createElement("span", null, "Retained content")),
    React.createElement(Suspend, { active: suspend }));
  try {
    await tree.render(scene(true));
    await tree.render(scene(false));
    timingCalls.length = 0;
    await act(async () => { React.startTransition(() => tree.root.render(scene(true, true))); });
    assert.equal(tree.container.querySelector('[role="dialog"]'), null);
    assert.equal(timingCalls.length, 0, "a speculative opening cannot start committed effects");
    await tree.render(scene(false));
    assert.equal(tree.container.querySelector('[role="dialog"]'), null, "abandoned retention state cannot leak into a closed commit");
    await tree.render(scene(true));
    assert.ok(tree.container.querySelector('[role="dialog"]'));
    await tree.render(scene(false));
    assert.equal(tree.container.querySelector('[role="dialog"]'), null);
  } finally {
    await tree.unmount();
    motion.reducedMotion = reduced;
  }
});

test("web ContextMenu measures from the layout report instead of forcing layout in the commit", async t => {
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

  const menu = tree.container.querySelector('[role="menu"]');
  assert.ok(menu, "the menu is mounted in the overlay host");
  events.entranceStarted = timingCalls.filter(call => call.value === 1).length;
  const provisional = JSON.parse(menu.getAttribute("data-teststyle"));
  assert.equal(events.entranceStarted, 0, "nothing may force a synchronous layout read before the entrance");
  assert.equal(provisional.top, 478, "the provisional placement uses the caller estimate");

  // RN Web's onLayout is a ResizeObserver report: it lands after the commit,
  // without reading layout inside React's layout-effect task.
  const body = menu.firstElementChild;
  const layout = layoutHandlers.get(body);
  assert.equal(typeof layout, "function", "the menu body has a layout subscription");
  await act(async () => { layout({ nativeEvent: { layout: { x: 0, y: 0, width: 240, height: nativeMeasureHeight } } }); });
  events.entranceStarted = timingCalls.filter(call => call.value === 1).length;
  const style = JSON.parse(tree.container.querySelector('[role="menu"]').getAttribute("data-teststyle"));
  // placeMenu above the trigger: 700 - 6 - (measured 320 + padding 16) = 358.
  assert.deepEqual({
    entranceStarted: events.entranceStarted,
    top: style.top,
  }, { entranceStarted: 1, top: 358 },
  "the layout report settles placement and starts the entrance");
  t.diagnostic(`layout settle: commits=${events.commits}, entranceStarts=${events.entranceStarted}, menuTop=${style.top}, publishes=${registryWork.publishes}`);

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

test("menu entrances decelerate while preserving the full fade and existing panel/exit curves", async () => {
  const tree = mount();
  const { FloatingPanel } = load(resolve(sourceRoot, "components/ui/FloatingPanel.tsx"));
  const menu = visible => React.createElement(ContextMenu, { visible, onDismiss() {}, anchor: { x: 20, y: 80, width: 40, height: 40 } },
    React.createElement("span", null, "Menu content"));
  try {
    resetWork();
    await tree.render(menu(true));
    assert.equal(timingCalls.filter(call => call.value === 1).length, 0, "no early opacity bypasses measurement");
    const body = tree.container.querySelector('[role="menu"]').firstElementChild;
    await act(async () => layoutHandlers.get(body)({ nativeEvent: { layout: { width: 240, height: 160 } } }));
    const entrance = timingCalls.find(call => call.value === 1);
    assert.equal(entrance.config.duration, 200);
    assert.equal(entrance.config.easing(0), 0);
    assert.equal(entrance.config.easing(1), 1);
    assert.ok(entrance.config.easing(0.25) > 0.5, "a measured menu reveals promptly then settles");
    timingCalls.length = 0;
    await tree.render(menu(false));
    const exit = timingCalls.find(call => call.value === 0);
    assert.equal(exit.config.duration, 200);
    assert.equal(exit.config.easing(0.25), 0.125, "exit keeps the original inOut quad");
    timingCalls.length = 0;
    await tree.render(React.createElement(FloatingPanel, { visible: true, onDismiss() {} }, React.createElement("span", null, "Panel content")));
    const panel = timingCalls.find(call => call.value === 1);
    assert.equal(panel.config.duration, 200);
    assert.equal(panel.config.easing(0.25), 0.125, "panel and scrim handoffs keep their original curve");
  } finally { await tree.unmount(); }
});

test("native panel input scope waits for layout and suspends during sibling pickers", async () => {
  resetWork();
  reactNative.Platform.OS = "android";
  const { FloatingPanel } = load(resolve(sourceRoot, "components/ui/FloatingPanel.tsx"));
  const { InputFocusScopeContext } = load(resolve(sourceRoot, "components/ui/input-focus-scope.ts"));
  let scope;
  function Probe() { scope = React.useContext(InputFocusScopeContext); return React.createElement("span", null, "input"); }
  const tree = mount();
  const render = props => tree.render(React.createElement(OverlayHost, null,
    React.createElement(FloatingPanel, { visible: true, onDismiss() {}, ...props }, React.createElement(Probe))));
  try {
    await render({});
    assert.deepEqual({ active: scope.active, ready: scope.ready, session: scope.session }, { active: true, ready: false, session: 0 }, "mount autofocus must wait for the native opening/keyboard-dismiss step");
    assert.equal(typeof dialogLayout, "function");
    await act(async () => { dialogLayout({ nativeEvent: { layout: { height: 200 } } }); });
    assert.deepEqual({ active: scope.active, ready: scope.ready, session: scope.session }, { active: true, ready: true, session: 0 });
    await render({ interactive: false });
    assert.deepEqual({ active: scope.active, ready: scope.ready, session: scope.session }, { active: false, ready: true, session: 0 });
    await render({});
    assert.deepEqual({ active: scope.active, ready: scope.ready, session: scope.session }, { active: true, ready: true, session: 0 });
    await render({ obscured: true });
    assert.equal(scope.active, false, "a sibling creation dialog owns focus");
    await render({ visible: false });
    assert.equal(scope.active, false, "exit-retained inputs cannot take focus");
    await render({});
    assert.equal(scope.session, 1, "a rapid reopen is a new focus session, not a picker resume");
    await render({ interactive: false });
    await render({});
    assert.equal(scope.session, 1, "resuming the same parent never replays autofocus");
  } finally {
    await tree.unmount();
    reactNative.Platform.OS = "web";
  }
});

test("native menu inputs become ready only after measurement and inactive on close", async () => {
  resetWork();
  reactNative.Platform.OS = "android";
  const { InputFocusScopeContext } = load(resolve(sourceRoot, "components/ui/input-focus-scope.ts"));
  let scope;
  function Probe() { scope = React.useContext(InputFocusScopeContext); return React.createElement("span", null, "search"); }
  const tree = mount();
  const render = visible => tree.render(React.createElement(OverlayHost, null,
    React.createElement(ContextMenu, { visible, onDismiss() {}, anchor: { x: 20, y: 100, width: 200, height: 48 } }, React.createElement(Probe))));
  try {
    await render(true);
    assert.deepEqual({ active: scope.active, ready: scope.ready, session: scope.session }, { active: true, ready: false, session: 0 });
    await act(async () => { pendingMeasures.at(-1).callback(0, 0, 200, 160); });
    assert.deepEqual({ active: scope.active, ready: scope.ready, session: scope.session }, { active: true, ready: true, session: 0 });
    await render(false);
    assert.equal(scope.active, false);
  } finally {
    await tree.unmount();
    reactNative.Platform.OS = "web";
  }
});

test("a covering overlay cancels a panel's opening callback without replay on uncover", async () => {
  resetWork();
  const { FloatingPanel } = load(resolve(sourceRoot, "components/ui/FloatingPanel.tsx"));
  let starts = 0, cancellations = 0;
  const onShow = () => { starts++; return () => { cancellations++; }; };
  const tree = mount();
  const render = (covered, interactive = true) => tree.render(React.createElement(OverlayHost, null,
    React.createElement(FloatingPanel, { visible: true, interactive, onDismiss() {}, onShow }, React.createElement("span", null, "form")),
    covered ? React.createElement(ContextMenu, { visible: true, onDismiss() {}, anchor: { x: 20, y: 100, width: 100, height: 48 } }, React.createElement("span", null, "picker")) : null));
  try {
    await render(false);
    assert.equal(starts, 1);
    await render(true);
    assert.equal(cancellations, 1, "pending focus work must be cancelled when another layer takes ownership");
    await render(false);
    assert.equal(starts, 1, "uncovering must not resurrect an old automatic focus request");
    await render(false, false);
    await render(false);
    assert.equal(starts, 1, "reactivating the same opening does not replay automatic focus");
  } finally {
    await tree.unmount();
  }
});
