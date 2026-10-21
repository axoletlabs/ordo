/** Run with: node --test apps/mobile/scripts/overlay-menu-races.test.cjs
 *
 * Real-source regressions for the shared popup/menu lifecycle:
 * - first-open measurement/entrance sequencing (no entrance while unplaced)
 * - rapid open/close around the exit fade (no retained invisible blocking)
 * - nested page transitions: rapid back-and-forth, close mid-fade, reduced motion
 * - a shown surface must never be reset to opacity 0 by a late readiness change
 * - FloatingPanel obscured/close in one commit must not fade a hidden stack back in
 *
 * ContextMenu, FloatingPanel, OverlayHost/OverlayPortal and use-overlay-presence
 * run against React DOM in jsdom. Only platform leaves (RN hosts, Reanimated,
 * icons, focus helpers) are stubbed. Reanimated shared values and timings are a
 * deterministic frame queue: animations only settle when a test flushes them,
 * so ordering and stale-callback behavior are observable.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("../../../node_modules/jsdom");

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

const React = require("../../../node_modules/react");
const { createRoot } = require("../../../node_modules/react-dom/client");
const { act } = React;

// jsdom has no layout engine. The mounted menu body is a known 320px tall.
const ELEMENT_HEIGHT = 320;
const layoutReads = { offsetHeight: 0 };
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() { layoutReads.offsetHeight += 1; return this.isConnected ? ELEMENT_HEIGHT : 0; },
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
  if (typeof style === "function") return {};
  return style;
};
const kebab = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const pendingMeasures = [];
let nativeMeasureHeight = ELEMENT_HEIGHT;
let dialogLayout;
const layoutHandlers = new WeakMap();
let panelLayout;

function host(tag) {
  return React.forwardRef(function Host({ children, style, dataSet, onLayout, pointerEvents, ...rest }, ref) {
    if (rest.role === "dialog") dialogLayout = onLayout;
    if (rest.testID === "material-panel-layout") panelLayout = onLayout;
    const attach = React.useCallback(node => {
      if (node && typeof node.measure !== "function") {
        node.measure = callback => { pendingMeasures.push({ node, callback }); };
      }
      if (node && onLayout) layoutHandlers.set(node, onLayout);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }, [ref, onLayout]);
    const domProps = { ref: attach, "data-teststyle": JSON.stringify(flattenStyle(style)) };
    if (rest.id) domProps.id = rest.id;
    if (rest.role) domProps.role = rest.role;
    if (rest.accessibilityRole) domProps.role = rest.accessibilityRole;
    if (rest.tabIndex != null) domProps.tabIndex = rest.tabIndex;
    if (rest["aria-hidden"] != null) domProps["aria-hidden"] = String(rest["aria-hidden"]);
    if (rest.testID) domProps["data-testid"] = rest.testID;
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("aria-") || key.startsWith("data-")) domProps[key] = value;
    }
    for (const [key, value] of Object.entries(dataSet ?? {})) domProps[`data-${kebab(key)}`] = String(value);
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

let animationQueue = [];
function sharedValue(initial) {
  const slot = {
    _value: initial,
    _animation: null,
    get value() { return this._value; },
    set value(next) {
      if (next && next.__animation) {
        this._animation = next;
        next.owner = slot;
        animationQueue.push(next);
      } else {
        this._animation = null;
        this._value = next;
      }
    },
  };
  return slot;
}
function flushAnimations() {
  let guard = 0;
  while (animationQueue.length) {
    assert.ok(++guard < 20, "animation flush did not settle");
    const batch = animationQueue;
    animationQueue = [];
    for (const animation of batch) {
      if (animation.cancelled || animation.owner?._animation !== animation) continue;
      animation.owner._animation = null;
      animation.owner._value = animation.target;
      animation.callback?.(true);
    }
  }
}
function cancelAnimation(value) {
  if (value && value._animation) {
    value._animation.cancelled = true;
    value._animation = null;
  }
}
const motionState = { reducedMotion: false };
const motion = { spatial: { stiffness: 700, damping: 52, mass: 1 }, effects: { stiffness: 3800, damping: 1, mass: 1 }, expressive: false };
const reanimated = {
  useSharedValue(initial) {
    const slot = React.useRef(null);
    if (slot.current === null) slot.current = sharedValue(initial);
    return slot.current;
  },
  useAnimatedStyle(worklet) { return worklet(); },
  withTiming(target, config, callback) { return { __animation: true, kind: "timing", target, config, callback }; },
  withSpring(target, config, callback) { return { __animation: true, kind: "spring", target, config, callback }; },
  cancelAnimation,
  runOnJS: callback => callback,
  interpolate: (value, input, output) => {
    if (!input?.length || input.length !== output.length) return value;
    const index = input.findIndex((point, i) => value >= point && (i === input.length - 1 || value <= input[i + 1]));
    if (index < 0) return output[0];
    if (index >= input.length - 1) return output[output.length - 1];
    const span = input[index + 1] - input[index];
    const progress = span === 0 ? 0 : (value - input[index]) / span;
    return output[index] + (output[index + 1] - output[index]) * progress;
  },
  Easing: { quad: value => value, inOut: fn => fn, in: fn => fn, out: fn => fn, bezier: () => value => value, linear: value => value },
};

/* --------------------------------- stubs ------------------------------------- */

const palette = new Proxy({}, { get: (_target, key) => `#${String(key)}` });
const themeState = { palette, shadows: { level2: {} }, expressive: false };
const stubs = new Map();
const modules = new Map();

function stub(relative, exports_) { stubs.set(resolve(sourceRoot, relative), exports_); }

const bareStubs = {
  "react": React,
  "react-native": reactNative,
  "react-native-reanimated": Object.assign({ __esModule: true }, reanimated, {
    default: { View: reactNative.View, createAnimatedComponent: component => component, ...reanimated },
  }),
  "react-native-safe-area-context": {
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  },
  "react-native-gesture-handler": {
    Gesture: { Pan: () => chainable() },
    GestureDetector: ({ children }) => children,
    Pressable: reactNative.Pressable,
  },
};
function chainable() {
  const node = { enabled: () => node, activeOffsetY: () => node, onStart: () => node, onUpdate: () => node, onEnd: () => node, onFinalize: () => node };
  return node;
}

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");

stub("theme/ThemeProvider.tsx", {
  useTheme: () => themeState,
  ThemeOverrideProvider: ({ children }) => children,
});
stub("theme/material-motion.ts", { useMaterialMotion: () => ({ ...motion, reducedMotion: motionState.reducedMotion }), materialMotion: {} });
stub("hooks/use-keyboard-visible.ts", {
  dismissKeyboard: () => {},
  keyboardIsOpen: () => false,
  useKeyboardViewportHeight: height => height,
});
stub("hooks/use-overlay-focus.ts", { useOverlayFocus: () => React.useRef(null) });
const AnimationActivityScopeContext = React.createContext(null);
function createAnimationActivityScope(initial = true) {
  let active = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => active,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActive(next) {
      if (next === active) return;
      active = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
stub("hooks/use-animation-activity.ts", {
  AnimationActivityContext: React.createContext(true),
  AnimationActivityScopeContext,
  createAnimationActivityScope,
  useAnimationActivity: () => true,
});
stub("lib/menu-outside-scroll.ts", { listenForMenuOutsideScroll: () => () => {} });
stub("lib/haptics.ts", { haptics: { light: () => {}, medium: () => {}, heavy: () => {} } });
stub("lib/panel-keyboard-layout.ts", { panelKeyboardLift: () => 0 });
stub("components/ui/input-focus-scope.ts", {
  InputFocusScopeContext: React.createContext({ active: true, ready: true, session: 0 }),
  useInputFocusScope: (active, ready) => ({ active, ready, session: 0 }),
});
stub("components/ui/input-surface.ts", { InputSurfaceContext: React.createContext(undefined) });
stub("components/ui/panel-title.ts", { PanelTitleContext: React.createContext(undefined) });
stub("components/ui/PressableScale.tsx", {
  PressableScale: React.forwardRef(function PressableScaleStub({ children, onPress, ...rest }, ref) {
    void rest;
    return React.createElement("div", { ref, onClick: onPress }, children);
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
stub("components/ui/PanelHeader.tsx", {
  PanelHeader: function PanelHeaderStub({ title }) { return React.createElement("h2", null, title); },
});
stub("components/ui/SheetActionRow.tsx", { PanelActions: ({ children }) => children ?? null });
stub("components/ui/ThemedScrollView.tsx", {
  ThemedScrollView: React.forwardRef(function ThemedScrollViewStub({ children }, ref) {
    return React.createElement("div", { ref }, children);
  }),
});
stub("theme/icon-glyph.tsx", { iconGlyphStyle: () => ({}) });
stub("theme/icon-glyph.ts", { iconGlyphStyle: () => ({}) });

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
const floatingPanelPath = resolve(sourceRoot, "components/ui/FloatingPanel.tsx");
const presencePath = resolve(sourceRoot, "hooks/use-overlay-presence.ts");
const { OverlayHost, OverlayPortal } = load(overlayHostPath);
const OverlayPortalStub = ({ children }) => React.createElement(OverlayPortal, { blocking: true }, children);
const { ContextMenu } = load(contextMenuPath);
const { FloatingPanel } = load(floatingPanelPath);

/* ---------------------------------- helpers ---------------------------------- */

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container, root,
    render: async next => { await act(async () => { root.render(next); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}
function resetAnimations() { animationQueue = []; }
function stylesOf(element) {
  return JSON.parse(element.getAttribute("data-teststyle") ?? "{}");
}
function opacityOf(element) { return stylesOf(element).opacity; }
function menuElement(container) { return container.querySelector('[role="menu"]'); }
function menuText(container) { return menuElement(container)?.textContent ?? ""; }
async function layoutMenuBody(container, height = ELEMENT_HEIGHT) {
  const body = menuElement(container)?.firstElementChild;
  const handler = body && layoutHandlers.get(body);
  assert.equal(typeof handler, "function", "the menu body exposes its layout");
  await act(async () => { handler({ nativeEvent: { layout: { x: 0, y: 0, width: 240, height } } }); });
}
function pageOpacity(container) {
  const menu = menuElement(container);
  if (!menu) return undefined;
  const nodes = [...menu.querySelectorAll("[data-teststyle]")].map(element => ({ element, style: stylesOf(element) }))
    .filter(entry => typeof entry.style.opacity === "number");
  return nodes.at(-1)?.style.opacity;
}
function flush() { act(() => { flushAnimations(); }); }
async function settle() { await act(async () => { flushAnimations(); }); }
/** Mountable harness with an explicit render function and stable state setters. */
function menuHarness(options = {}) {
  const tree = mount();
  const initial = { visible: options.visible ?? false, pageKey: options.pageKey ?? "actions", sessionKey: options.sessionKey ?? null, label: options.label ?? "first" };
  const events = { exited: 0, exiting: 0 };
  let setState;
  let forceUpdate;
  function Harness() {
    const [state, set] = React.useState(initial);
    const [, force] = React.useState(0);
    setState = next => set(current => ({ ...current, ...next }));
    forceUpdate = () => force(value => value + 1);
    return React.createElement(ContextMenu, {
      visible: state.visible, onDismiss: () => {}, anchor: { x: 40, y: 520, width: 40, height: 40 },
      sessionKey: state.sessionKey, pageKey: state.pageKey,
      onExited: () => { events.exited += 1; }, onExiting: () => { events.exiting += 1; },
      ...options.props,
    }, React.createElement("span", null, state.label), Array.from({ length: options.items ?? 3 }, (_, index) =>
      React.createElement("span", { key: index }, ` item ${index} `)));
  }
  const element = () => React.createElement(OverlayHost, null, React.createElement(Harness));
  return {
    tree, events,
    render: async next => { await act(async () => { setState(next); }); },
    rerender: async () => { await act(async () => { forceUpdate(); }); },
    layout: async (height = ELEMENT_HEIGHT) => layoutMenuBody(tree.container, height),
    mountInitial: async () => { await tree.render(element()); },
    remount: async () => { await tree.render(element()); },
  };
}

/* ---------------------------------- tests ------------------------------------ */

test("context menu measures and places before starting its entrance", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "alpha" });
  await harness.mountInitial();
  const menu = menuElement(harness.tree.container);
  assert.ok(menu, "the menu mounts into the overlay host");
  assert.equal(layoutReads.offsetHeight, 0, "mounting a menu must not force a synchronous layout read");
  assert.equal(menu.textContent, "alpha item 0  item 1  item 2 ", "contents are laid out while still invisible");
  assert.equal(opacityOf(menu), 0, "the entrance has not run before measurement settles");
  assert.equal(animationQueue.filter(animation => animation.target === 1).length, 0, "no entrance is scheduled before layout reports");
  assert.equal(stylesOf(menu).top, 566, "the provisional placement uses the caller estimate");

  await harness.layout();
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1, "the entrance settles fully visible");
  const style = stylesOf(menuElement(harness.tree.container));
  assert.equal(style.top, 178, "placement uses the measured 320px body above the anchor");
  t.diagnostic(`menu body: text=${JSON.stringify(menu.textContent)} top=${style.top}`);
  await harness.tree.unmount();
});

test("a shown menu is not reset to opacity 0 by a late readiness change", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "alpha" });
  await harness.mountInitial();
  await harness.layout();
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1);

  // A new session key while the menu stays visible forces a re-measure. The
  // surface must keep its committed opacity instead of blanking until layout.
  await harness.render({ sessionKey: "other", label: "beta" });
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1, "the retained surface never drops to opacity 0");
  assert.equal(menuText(harness.tree.container).startsWith("beta"), true, "the new contents are committed");
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1);
  // The stale height must not have locked placement: the new session's smaller
  // body moves the menu below the same trigger.
  await layoutMenuBody(harness.tree.container, 120);
  await harness.rerender();
  assert.equal(stylesOf(menuElement(harness.tree.container)).top, 566, "the new measurement decides placement");
  t.diagnostic(`session swap: opacity=${opacityOf(menuElement(harness.tree.container))} top=${stylesOf(menuElement(harness.tree.container)).top}`);
  await harness.tree.unmount();
});

test("closing before the first measurement releases the invisible surface immediately", async t => {
  resetAnimations();
  reactNative.Platform.OS = "android";
  const tree = mount();
  try {
    let setVisible;
    function Harness() {
      const [visible, set] = React.useState(true);
      setVisible = set;
      return React.createElement(ContextMenu, { visible, onDismiss: () => {}, anchor: { x: 40, y: 120, width: 40, height: 40 } },
        React.createElement("span", null, "native menu"));
    }
    await tree.render(React.createElement(OverlayHost, null, React.createElement(Harness)));
    assert.ok(menuElement(tree.container), "the unmeasured native menu is retained invisibly");
    await act(async () => { setVisible(false); });
    assert.equal(menuElement(tree.container) === null, true, "nothing was painted, so the close must not wait for a 200ms fade");
    assert.equal(animationQueue.length, 0, "no exit animation is allocated for an invisible surface");
  } finally {
    reactNative.Platform.OS = "web";
    await tree.unmount();
  }
});

test("rapid page changes keep the page that is actually on screen until the swap", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "A", pageKey: "actions" });
  await harness.mountInitial();
  await harness.layout();
  await settle();
  await harness.rerender();
  assert.equal(menuText(harness.tree.container).startsWith("A"), true);

  // A -> B begins the fade-through, freezing A.
  await harness.render({ label: "B", pageKey: "remind" });
  assert.equal(menuText(harness.tree.container).startsWith("A"), true, "outgoing page stays frozen during the fade");

  // Back to A before the fade-out completes. B was never painted, so the
  // surface must keep showing A rather than freezing the unseen B.
  await harness.render({ label: "A", pageKey: "actions" });
  assert.equal(menuText(harness.tree.container).startsWith("A"), true, "an intermediate page must never reach the screen");

  await settle();
  await settle();
  await harness.rerender();
  assert.equal(menuText(harness.tree.container).startsWith("A"), true);
  assert.equal(pageOpacity(harness.tree.container), 1, "the returned page fades back to full opacity");
  t.diagnostic(`rapid pages settled on ${JSON.stringify(menuText(harness.tree.container))}`);
  await harness.tree.unmount();
});

test("closing mid page-transition exits with visible retained contents", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "A", pageKey: "actions" });
  await harness.mountInitial();
  await harness.layout();
  await settle();
  await harness.rerender();
  await harness.render({ label: "B", pageKey: "remind" });
  // The fade-out settles and swaps to B; close before its fade-in frame lands.
  await settle();
  assert.equal(menuText(harness.tree.container).startsWith("B"), true, "the incoming page has been committed");
  assert.equal(pageOpacity(harness.tree.container), 0, "the incoming page is still transparent when it arrives");
  await harness.render({ visible: false, label: "B", pageKey: "remind" });
  await harness.rerender();
  assert.equal(harness.events.exiting, 1, "the exit handoff still fires once");
  assert.ok(menuElement(harness.tree.container), "the tree is retained through the exit");
  assert.notEqual(pageOpacity(harness.tree.container), 0, "retained contents must not be invisible during exit");

  await settle();
  await harness.render({ visible: false });
  assert.equal(harness.events.exited, 1, "the completed exit unmounts and hands off once");
  assert.equal(menuElement(harness.tree.container) === null, true);
  t.diagnostic(`exit after interrupted page: exiting=${harness.events.exiting} exited=${harness.events.exited}`);
  await harness.tree.unmount();
});

test("a stale page-transition callback cannot blank a reopened menu", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "A", pageKey: "actions" });
  await harness.mountInitial();
  await harness.layout();
  await settle();
  await harness.rerender();
  await harness.render({ label: "B", pageKey: "remind" });
  await harness.render({ visible: false });
  await settle();
  await harness.render({ visible: false });
  assert.equal(menuElement(harness.tree.container) === null, true);

  // Reopen on the same page key the interrupted transition targeted.
  await harness.render({ visible: true, label: "B", pageKey: "remind" });
  await harness.layout();
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1, "reopening is fully visible despite the old transition");
  assert.equal(menuText(harness.tree.container).startsWith("B"), true, "the reopened page is the current page");
  t.diagnostic(`reopened opacity=${opacityOf(menuElement(harness.tree.container))}`);
  await harness.tree.unmount();
});

test("a page callback that fires after close/reopen cannot blank the surface", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "A", pageKey: "actions" });
  await harness.mountInitial();
  await harness.layout();
  await settle();
  await harness.rerender();

  await harness.render({ label: "B", pageKey: "remind" });
  const stale = animationQueue.at(-1);
  assert.equal(typeof stale?.callback, "function", "the page fade registered a completion callback");

  await harness.render({ visible: false });
  await settle();
  await harness.render({ visible: false });
  await harness.render({ visible: true, label: "B", pageKey: "remind" });
  await harness.layout();
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1);

  // The UI thread can still deliver the pre-close completion after the reopen.
  await act(async () => { stale.callback(true); });
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1, "the stale settle is ignored");
  assert.equal(menuText(harness.tree.container).startsWith("B"), true);
  t.diagnostic(`stale page callback: opacity=${opacityOf(menuElement(harness.tree.container))}`);
  await harness.tree.unmount();
});

test("a discarded closing render cannot cancel the committed menu page transition", async t => {
  resetAnimations();
  const tree = mount();
  t.after(() => tree.unmount());
  let suspended = 0;
  const never = new Promise(() => {});
  function Suspend({ active }) {
    if (active) { suspended++; throw never; }
    return null;
  }
  const scene = (visible, page, suspend = false) => React.createElement(React.Suspense, { fallback: "pending" },
    React.createElement(OverlayHost, null,
      React.createElement(ContextMenu, { visible, pageKey: page, onDismiss: () => {}, anchor: { x: 40, y: 520, width: 40, height: 40 } }, page),
      React.createElement(Suspend, { active: suspend })));
  await tree.render(scene(true, "A"));
  await layoutMenuBody(tree.container);
  await settle();
  await tree.render(scene(true, "B"));
  const fade = animationQueue.findLast(animation => animation.target === 0 && animation.callback);
  assert.ok(fade, "the committed B transition has a pending fade");
  await act(async () => { React.startTransition(() => tree.root.render(scene(false, "B", true))); });
  assert.ok(suspended > 0, "the closing render ran but never committed");
  assert.equal(menuText(tree.container), "A", "the original surface remains committed");
  await act(async () => {
    fade.owner._value = 0;
    fade.callback(true);
  });
  await tree.render(scene(true, "B"));
  await settle();
  await tree.render(scene(true, "B"));
  assert.equal(menuText(tree.container), "B");
  assert.equal(pageOpacity(tree.container), 1, "discarded props must not strand the committed page at opacity zero");
});

test("a discarded page render never publishes its unseen contents", async t => {
  resetAnimations();
  const tree = mount();
  t.after(() => tree.unmount());
  let suspended = 0;
  const never = new Promise(() => {});
  function Suspend({ active }) {
    if (active) { suspended++; throw never; }
    return null;
  }
  const scene = (page, suspend = false) => React.createElement(React.Suspense, { fallback: "pending" },
    React.createElement(OverlayHost, null,
      React.createElement(ContextMenu, { visible: true, pageKey: page, onDismiss: () => {}, anchor: { x: 40, y: 520, width: 40, height: 40 } }, page),
      React.createElement(Suspend, { active: suspend })));
  await tree.render(scene("A"));
  await layoutMenuBody(tree.container);
  await settle();
  await act(async () => { React.startTransition(() => tree.root.render(scene("unseen B", true))); });
  assert.ok(suspended > 0);
  await tree.render(scene("A"));
  await settle();
  await tree.render(scene("A"));
  assert.equal(menuText(tree.container), "A", "abandoned content never becomes the retained outgoing page");
  assert.equal(pageOpacity(tree.container), 1);
});

test("reopening on a different page never flashes the previous session", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "A", pageKey: "actions" });
  await harness.mountInitial();
  await harness.layout();
  await settle();
  await harness.rerender();
  await harness.render({ visible: false });
  await settle();
  await harness.render({ visible: false });
  assert.equal(menuElement(harness.tree.container) === null, true);

  await harness.render({ visible: true, label: "B", pageKey: "remind" });
  assert.equal(menuText(harness.tree.container).startsWith("B"), true, "a fresh open paints its own page, not the retained one");
  await harness.layout();
  await settle();
  await harness.rerender();
  assert.equal(menuText(harness.tree.container).startsWith("B"), true);
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1);
  t.diagnostic(`fresh page open: ${JSON.stringify(menuText(harness.tree.container))}`);
  await harness.tree.unmount();
});

test("reduced-motion page changes never schedule a fade and never blank contents", async t => {
  resetAnimations();
  motionState.reducedMotion = true;
  try {
    const harness = menuHarness({ visible: true, label: "A", pageKey: "actions" });
    await harness.mountInitial();
    await harness.layout();
    await settle();
    await harness.rerender();
    assert.equal(opacityOf(menuElement(harness.tree.container)), 1);
    await harness.render({ label: "B", pageKey: "remind" });
    await harness.rerender();
    assert.equal(menuText(harness.tree.container).startsWith("B"), true, "the next page is committed synchronously");
    assert.equal(pageOpacity(harness.tree.container), 1, "reduced motion keeps the page fully visible");
    assert.equal(animationQueue.length, 0, "no page or entrance animation remains queued");
    t.diagnostic(`reduced motion page opacity=${pageOpacity(harness.tree.container)} queued=${animationQueue.length}`);
    await harness.tree.unmount();
  } finally {
    motionState.reducedMotion = false;
  }
});

test("rapid close and reopen during the exit fade settles fully visible", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "A" });
  await harness.mountInitial();
  await harness.layout();
  await settle();
  await harness.rerender();
  await harness.render({ visible: false });
  assert.equal(harness.events.exiting, 1);
  await harness.render({ visible: true });
  // No layout report after the reopen: the retained exit tree reuses its
  // committed body measurement instead of waiting for a ResizeObserver that
  // will not fire again for an unchanged size.
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1, "the interrupted exit reverses into a full entrance");
  assert.equal(harness.events.exited, 0, "the stale exit completion must not fire after a reopen");
  await harness.render({ visible: false });
  await settle();
  await harness.render({ visible: false });
  assert.equal(harness.events.exited, 1, "the next completed close hands off exactly once");
  t.diagnostic(`handoff: exiting=${harness.events.exiting} exited=${harness.events.exited}`);
  await harness.tree.unmount();
});

test("reopening a retained menu for another session waits for its own measurement", async t => {
  resetAnimations();
  const harness = menuHarness({ visible: true, label: "large A", sessionKey: "A" });
  t.after(() => harness.tree.unmount());
  await harness.mountInitial();
  await harness.layout(320);
  await settle();
  await harness.rerender();
  await harness.render({ visible: false });
  await harness.render({ visible: true, label: "short B", sessionKey: "B" });
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 0,
    "another row's retained height must not reveal this menu on the wrong side");
  await harness.layout(120);
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1);
  assert.equal(stylesOf(menuElement(harness.tree.container)).top, 566);
});

test("every web menu session gets a fresh async measurement even at an unchanged size", async t => {
  resetAnimations();
  const previous = globalThis.ResizeObserver;
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node) { this.node = node; }
    disconnect() { this.disconnected = true; }
    emit(height) { this.callback([{ target: this.node, contentRect: { height } }]); }
  };
  t.after(() => { globalThis.ResizeObserver = previous; });
  const harness = menuHarness({ visible: true, sessionKey: "A" });
  t.after(() => harness.tree.unmount());
  await harness.mountInitial();
  const first = observers.at(-1);
  assert.ok(first?.node);
  await act(async () => first.emit(320));
  await settle();
  await harness.rerender();
  await harness.render({ visible: false });
  await harness.render({ visible: true, sessionKey: "B" });
  const second = observers.at(-1);
  assert.notEqual(second, first, "reopening observes again rather than waiting for a size change");
  assert.equal(first.disconnected, true);
  await act(async () => first.emit(120));
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 0, "stale measurements cannot release a newer opening");
  await act(async () => second.emit(320));
  await settle();
  await harness.rerender();
  assert.equal(opacityOf(menuElement(harness.tree.container)), 1);
  assert.equal(stylesOf(menuElement(harness.tree.container)).top, 178);
  assert.equal(layoutReads.offsetHeight, 0);
});

/* ------------------------------ floating panels ------------------------------ */

function panelHarness(options = {}) {
  const tree = mount();
  const initial = { visible: options.visible ?? false, obscured: options.obscured ?? false, interactive: options.interactive ?? true };
  const events = { exited: 0, exiting: 0 };
  let setState;
  let forceUpdate;
  function Harness() {
    const [state, set] = React.useState(initial);
    const [, force] = React.useState(0);
    setState = next => set(current => ({ ...current, ...next }));
    forceUpdate = () => force(value => value + 1);
    return React.createElement(FloatingPanel, {
      visible: state.visible, obscured: state.obscured, interactive: state.interactive,
      onDismiss: () => {},
      onExited: () => { events.exited += 1; }, onExiting: () => { events.exiting += 1; },
      ...options.props,
    }, React.createElement("h2", null, "Panel title"), React.createElement("span", null, "panel body"));
  }
  const element = () => React.createElement(OverlayHost, null, React.createElement(Harness));
  return {
    tree, events,
    render: async next => { await act(async () => { setState(next); }); },
    rerender: async () => { await act(async () => { forceUpdate(); }); },
    mountInitial: async () => { await tree.render(element()); },
    layout: async (height = 260) => {
      assert.equal(typeof dialogLayout, "function", "the panel exposes its layout");
      await act(async () => { dialogLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 320, height } } }); });
    },
  };
}
function overlayRoot(container) {
  const layer = container.querySelector("[data-overlay-layer]");
  return layer?.firstElementChild ?? null;
}
function panelElement(container) { return container.querySelector('[role="dialog"]'); }
function scrimOpacity(container) {
  // Native layers do not carry the web-only data attribute; reach the root
  // through the dialog's frame instead.
  const root = overlayRoot(container) ?? panelElement(container)?.parentElement?.parentElement ?? null;
  return root ? opacityOf(root.firstElementChild) : undefined;
}

test("a panel opening callback is consumed once and does not replay after a child picker", async t => {
  resetAnimations();
  let shows = 0;
  let cancellations = 0;
  const harness = panelHarness({ visible: true, props: { onShow: () => { shows++; return () => cancellations++; } } });
  t.after(() => harness.tree.unmount());
  await harness.mountInitial();
  await settle();
  assert.equal(shows, 1);
  await harness.render({ obscured: true });
  assert.equal(cancellations, 1, "covering the surface cancels any pending opening work");
  await harness.render({ obscured: false });
  await settle();
  assert.equal(shows, 1, "resuming the same opening cannot steal focus again");
  await harness.render({ visible: false });
  await settle();
  await harness.render({ visible: true });
  await settle();
  assert.equal(shows, 2, "a fresh opening receives its own callback");
});

test("a closing obscured panel is not faded back in by its sibling leaving", async t => {
  resetAnimations();
  const harness = panelHarness({ visible: true });
  await harness.mountInitial();
  await settle();
  await harness.rerender();
  assert.equal(scrimOpacity(harness.tree.container), 1, "the open panel scrim is fully visible");

  await harness.render({ obscured: true });
  await settle();
  await harness.rerender();
  const root = overlayRoot(harness.tree.container);
  assert.equal(stylesOf(root).display, "none", "the obscured panel is collapsed only after its fade");
  assert.equal(scrimOpacity(harness.tree.container), 0);

  // A sibling picker and this panel close in the same commit.
  await harness.render({ visible: false, obscured: false });
  await harness.rerender();
  assert.equal(stylesOf(root).display, "none", "the exiting panel stays collapsed");
  assert.equal(animationQueue.some(animation => animation.target === 1), false, "no reveal fade is scheduled while closing");
  assert.equal(harness.events.exiting, 1, "the exit handoff still fires once");

  await settle();
  await harness.render({ visible: false });
  assert.equal(harness.events.exited, 1, "the exit completes exactly once");
  assert.equal(overlayRoot(harness.tree.container) === null, true);

  await harness.render({ visible: true });
  await settle();
  await harness.rerender();
  assert.notEqual(stylesOf(overlayRoot(harness.tree.container)).display, "none", "a later open reveals the panel again");
  assert.equal(scrimOpacity(harness.tree.container), 1);
  t.diagnostic(`obscured close: exiting=${harness.events.exiting} exited=${harness.events.exited}`);
  await harness.tree.unmount();
});

test("reduced motion closes an obscured panel without a queued fade", async t => {
  resetAnimations();
  motionState.reducedMotion = true;
  try {
    const harness = panelHarness({ visible: true, obscured: true });
    await harness.mountInitial();
    await settle();
    await harness.rerender();
    await harness.render({ visible: false, obscured: false });
    assert.equal(harness.events.exiting, 1);
    assert.equal(harness.events.exited, 1, "reduced motion releases both hooks in the close task");
    assert.equal(animationQueue.length, 0, "no animation is allocated");
    assert.equal(overlayRoot(harness.tree.container) === null, true);
    await harness.tree.unmount();
  } finally {
    motionState.reducedMotion = false;
  }
});

test("a native panel closed before its first layout releases immediately", async t => {
  resetAnimations();
  reactNative.Platform.OS = "android";
  try {
    const harness = panelHarness({ visible: true });
    await harness.mountInitial();
    assert.ok(panelElement(harness.tree.container), "the unmeasured panel is retained invisibly");
    await harness.render({ visible: false });
    assert.equal(panelElement(harness.tree.container) === null, true);
    assert.equal(harness.events.exiting, 1);
    assert.equal(harness.events.exited, 1);
    assert.equal(animationQueue.length, 0, "no exit animation is allocated for an unpainted panel");
    await harness.tree.unmount();
  } finally {
    reactNative.Platform.OS = "web";
  }
});

test("panel onExiting fires once per close and a reopened exit is cancel-safe", async t => {
  resetAnimations();
  const harness = panelHarness({ visible: true });
  await harness.mountInitial();
  await settle();
  await harness.rerender();
  await harness.render({ visible: false });
  assert.equal(harness.events.exiting, 1);
  await harness.render({ visible: true });
  await settle();
  await harness.rerender();
  assert.equal(harness.events.exited, 0, "the interrupted exit never hands off");
  await harness.render({ visible: false });
  assert.equal(harness.events.exiting, 2, "each close fires the handoff exactly once");
  await settle();
  await harness.render({ visible: false });
  assert.equal(harness.events.exited, 1, "only the completed close notifies once");
  t.diagnostic(`panel handoff: exiting=${harness.events.exiting} exited=${harness.events.exited}`);
  await harness.tree.unmount();
});

test("stacked overlays transfer isolation to the surviving layer and clean up", async t => {
  resetAnimations();
  const tree = mount();
  function Harness({ count }) {
    return React.createElement(OverlayHost, null,
      count >= 1 ? React.createElement(OverlayPortalStub, { id: "one" }, React.createElement("span", null, "one")) : null,
      count >= 2 ? React.createElement(OverlayPortalStub, { id: "two" }, React.createElement("span", null, "two")) : null);
  }
  let setCount;
  function Root() {
    const [count, set] = React.useState(1);
    setCount = set;
    return React.createElement(Harness, { count });
  }
  await tree.render(React.createElement(Root));
  const background = tree.container.children[0];
  const host = tree.container.children[1];
  assert.equal(background.getAttribute("aria-hidden"), "true", "the app background is isolated while a blocking layer is open");
  assert.equal(document.documentElement.style.overflow, "hidden", "background scrolling is locked");

  await act(async () => { setCount(2); });
  const layers = [...host.children].filter(element => element.hasAttribute("data-overlay-layer"));
  assert.equal(layers.length, 2);
  assert.equal(layers[0].getAttribute("aria-hidden"), "true", "the lower layer is inert under the top one");
  assert.notEqual(layers[1].getAttribute("aria-hidden"), "true", "the top layer is never inert");

  await act(async () => { setCount(1); });
  const survivors = [...host.children].filter(element => element.hasAttribute("data-overlay-layer"));
  assert.equal(survivors.length, 1);
  assert.notEqual(survivors[0].getAttribute("aria-hidden"), "true", "the surviving layer is released from the lower-layer lock");
  assert.equal(background.getAttribute("aria-hidden"), "true", "the background stays isolated");

  await act(async () => { setCount(0); });
  assert.equal(background.getAttribute("aria-hidden"), null, "the background is released after the last layer closes");
  assert.equal(document.documentElement.style.overflow, "", "document scrolling is restored");
  t.diagnostic(`isolation layers=2->1->0, overflow=${JSON.stringify(document.documentElement.style.overflow)}`);
  await tree.unmount();
});

test("a menu that never receives a layout report still becomes visible", async t => {
  resetAnimations();
  reactNative.Platform.OS = "android";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = menuHarness({ visible: true, label: "fallback" });
  try {
    await harness.mountInitial();
    const menu = menuElement(harness.tree.container);
    assert.equal(opacityOf(menu), 0, "the entrance waits for layout first");
    await act(async () => { t.mock.timers.tick(200); });
    await settle();
    await harness.rerender();
    assert.equal(opacityOf(menuElement(harness.tree.container)), 1, "the readiness fallback releases the entrance");
    // The provisional estimate wins below the anchor until a real report lands.
    assert.equal(stylesOf(menuElement(harness.tree.container)).top, 566);
    t.diagnostic(`fallback: top=${stylesOf(menuElement(harness.tree.container)).top}`);
  } finally {
    t.mock.timers.reset();
    reactNative.Platform.OS = "web";
    await harness.tree.unmount();
  }
});

test("a panel that never receives a native layout report still opens", async t => {
  resetAnimations();
  reactNative.Platform.OS = "android";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = panelHarness({ visible: true });
  try {
    await harness.mountInitial();
    assert.equal(scrimOpacity(harness.tree.container), 0);
    await act(async () => { t.mock.timers.tick(200); });
    await settle();
    await harness.rerender();
    assert.equal(scrimOpacity(harness.tree.container), 1, "the readiness fallback reveals the dialog");
    assert.ok(panelElement(harness.tree.container), "the panel is interactive after the fallback");
    t.diagnostic(`panel fallback scrim=${scrimOpacity(harness.tree.container)}`);
  } finally {
    t.mock.timers.reset();
    reactNative.Platform.OS = "web";
    await harness.tree.unmount();
  }
});
