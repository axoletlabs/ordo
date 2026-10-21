/** Run with: node --test apps/mobile/scripts/background-overlay-subscription.test.cjs
 *
 * Actual-source render work for the background side of a blocking overlay.
 * The real OverlayHost, ThemedScrollView, ThemedFlatList and Input sources run
 * on React DOM in jsdom; only platform leaves and unrelated controls are
 * stubbed.
 *
 * On web the background is already made inert by OverlayHost/isolateModal.
 * Input and the scroll wrappers therefore must not subscribe to
 * OverlayBlockedContext there: doing so re-rendered every field/scroller on
 * every popup opening. Native has no inherited inert, so it must keep the
 * live subscription and force scrollEnabled=false.
 *
 * Host pause is published through a stable external scope. A legacy-context
 * descendant must not reconcile when that scope changes; only animation leaf
 * hooks subscribe to it.
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
const kebab = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

function createHarness(platform) {
  const counts = { input: 0, scroll: 0, list: 0 };
  const latest = { scroll: undefined, list: undefined };
  const palette = new Proxy({}, { get: (_target, key) => key === "mode" ? "dark" : `#${String(key)}` });
  const spacing = new Proxy({}, { get: () => 8 });
  const radius = new Proxy({}, { get: () => 8 });
  const fontSize = new Proxy({}, { get: () => 16 });

  const host = tag => React.forwardRef(function Host({ children, dataSet, testID, ...rest }, ref) {
    const props = { ref };
    if (testID) props["data-testid"] = testID;
    if (rest.id) props.id = rest.id;
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("aria-") || key.startsWith("data-")) props[key] = value;
    }
    for (const [key, value] of Object.entries(dataSet ?? {})) props[`data-${kebab(key)}`] = String(value);
    return React.createElement(tag, props, children);
  });

  const View = host("div");
  const Text = host("span");
  const ScrollView = React.forwardRef(function ScrollView({ children, scrollEnabled, ...rest }, ref) {
    counts.scroll += 1;
    latest.scroll = scrollEnabled;
    void rest;
    return React.createElement("div", { ref }, children);
  });
  const FlatList = React.forwardRef(function FlatList({ scrollEnabled, ...rest }, ref) {
    counts.list += 1;
    latest.list = scrollEnabled;
    void rest;
    return React.createElement("div", { ref });
  });
  const TextInput = React.forwardRef(function TextInput(props, ref) {
    counts.input += 1;
    void props;
    return React.createElement("input", { ref });
  });
  TextInput.State = { currentlyFocusedInput: () => null };

  const reactNative = {
    Platform: { OS: platform, select: options => options[platform] ?? options.default },
    View, Text, ScrollView, FlatList, TextInput,
    Pressable: host("div"),
    StyleSheet: { create: styles => styles, flatten: style => style, absoluteFill: {} },
    AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    Keyboard: { dismiss() {}, metrics: () => null, isVisible: () => false, addListener: () => ({ remove() {} }) },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    I18nManager: { isRTL: false },
    NativeModules: {},
  };

  const reanimated = {
    useSharedValue: initial => React.useRef({ value: initial }).current,
    useAnimatedStyle: () => ({}),
    withTiming: value => value,
    withSpring: value => value,
    cancelAnimation() {},
    runOnJS: callback => callback,
    interpolate: value => value,
    useAnimatedScrollHandler: () => undefined,
    useComposedEventHandler: () => undefined,
    LinearTransition: {
      springify() { return this; },
      mass() { return this; },
      stiffness() { return this; },
      damping() { return this; },
    },
    Easing: { quad: value => value, inOut: fn => fn, in: fn => fn, out: fn => fn, bezier: () => value => value, linear: value => value },
  };
  reanimated.default = { View, Text, ScrollView, FlatList, createAnimatedComponent: component => component, ...reanimated };
  reanimated.__esModule = true;

  const stubs = [
    ["theme/ThemeProvider", { useTheme: () => ({ palette, shadows: {}, expressive: false }), ThemeOverrideProvider: ({ children }) => children }],
    ["theme/tokens", { spacing, radius, fontSize, resolveFont: () => "sans" }],
    ["theme/material-motion", { useMaterialMotion: () => ({ reducedMotion: true, fast: { mass: 1, stiffness: 1, damping: 1 }, spatial: {}, effects: {} }) }],
    ["theme/state-layer", { alphaTint: color => color }],
    ["theme/scrollbar", { scrollViewShouldFill: () => false }],
    ["components/ui/StateLayer", { StateLayer: () => null }],
    ["components/ui/Text", { Text }],
    ["components/ui/MaterialIcon", { MaterialIcon: () => null }],
    ["components/ui/input-surface", { InputSurfaceContext: React.createContext(null) }],
    ["components/ui/panel-title", { PanelTitleContext: React.createContext(null) }],
    ["components/ui/input-focus-scope", {
      InputFocusScopeContext: React.createContext(null),
      markNativeFocus() {},
      nativeFocusPermitted: () => true,
      registerNativeFocusField: () => () => {},
    }],
    ["components/ui/ScrollBar", {
      chainHandlers: (...handlers) => (...args) => { for (const handler of handlers) handler?.(...args); },
      splitScrollLayoutStyle: style => ({ wrapper: null, inner: style }),
      useScrollBarInsets: () => ({}),
      useVerticalScrollBar: () => ({ overlay: null, indicatorStyle: undefined, onLayout: null, updateScroll: null,
        onScrollActivity: null, onContentSizeChange: null }),
    }],
    ["components/ui/RefreshHud", { RefreshHud: () => null }],
    ["components/ui/BookmarkListSkeleton", { BookmarkListSkeleton: () => null }],
    ["hooks/use-material-refresh", {
      useMaterialRefresh: () => ({ gesture: null, dy: 0, onScroll: undefined, onTouchStart: undefined,
        onTouchMove: undefined, onTouchEnd: undefined, onTouchCancel: undefined }),
    }],
    ["hooks/use-scene-ready", { useSceneReady: () => true }],
    ["lib/focus-text-input", { focusTextInput() {} }],
    ["lib/native-input-edit", { nativeInputEdit: () => "none" }],
    ["lib/input-privacy", { isSensitiveInput: () => false, privateKeyboardType: (_platform, _secret, _secure, keyboardType) => keyboardType }],
    ["lib/web-input-caret", { caretAfterKey: () => null, shouldCorrectWebCaret: () => false }],
    ["lib/list-pagination", { LIST_END_REACHED_THRESHOLD: 0.5 }],
    ["lib/scroll-report", { shouldReportScroll: () => true }],
  ];

  const actual = new Set([
    resolve(sourceRoot, "components/ui/overlay-host.tsx"),
    resolve(sourceRoot, "components/ui/ThemedScrollView.tsx"),
    resolve(sourceRoot, "components/ui/Input.tsx"),
    resolve(sourceRoot, "lib/overlay-registry.ts"),
    resolve(sourceRoot, "lib/modal-isolation.ts"),
    resolve(sourceRoot, "hooks/use-animation-activity.ts"),
  ]);
  const cache = new Map();

  function resolveModule(from, id) {
    const base = resolve(dirname(from), id);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]) {
      try {
        if (require("node:fs").statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    return base;
  }

  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    new Function("require", "module", "exports", outputText)(id => {
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return require("react/jsx-runtime");
      if (id === "react-native") return reactNative;
      if (id === "react-native-reanimated") return reanimated;
      if (id === "react-native-gesture-handler") return { GestureDetector: ({ children }) => children };
      if (id.startsWith(".")) {
        const resolved = resolveModule(filename, id);
        if (actual.has(resolved)) return load(resolved);
        const normalized = resolved.replaceAll("\\", "/").replace(/\.(ts|tsx|js|mjs)$/, "").replace(/\/index$/, "");
        const stub = stubs.find(([suffix]) => normalized.endsWith(suffix));
        if (stub) return stub[1];
        throw new Error(`Unexpected dependency: ${id} (${resolved}) from ${filename}`);
      }
      throw new Error(`Unexpected package: ${id} from ${filename}`);
    }, module, module.exports);
    return module.exports;
  }

  return { load, counts, latest };
}

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.requestAnimationFrame = callback => dom.window.requestAnimationFrame(callback);
  globalThis.cancelAnimationFrame = id => dom.window.cancelAnimationFrame(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return { dom, previous };
}

function teardownDom({ dom, previous }) {
  dom.window.close();
  globalThis.window = previous.window;
  globalThis.document = previous.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
}

async function run(platform) {
  const harness = createHarness(platform);
  const overlayHost = harness.load(resolve(sourceRoot, "components/ui/overlay-host.tsx"));
  const themed = harness.load(resolve(sourceRoot, "components/ui/ThemedScrollView.tsx"));
  const input = harness.load(resolve(sourceRoot, "components/ui/Input.tsx"));
  const activity = harness.load(resolve(sourceRoot, "hooks/use-animation-activity.ts"));
  const { OverlayHost, OverlayPortal, useOverlayBlocked } = overlayHost;
  const { ThemedScrollView, ThemedFlatList } = themed;
  const { Input } = input;
  const { AnimationActivityContext, useAnimationActivity } = activity;

  const activityValues = [];
  const legacyValues = [];
  const blockedValues = [];
  function ActivityProbe() {
    activityValues.push(useAnimationActivity());
    return null;
  }
  function LegacyProbe() {
    legacyValues.push(React.useContext(AnimationActivityContext));
    return null;
  }
  function BlockedProbe() {
    blockedValues.push(useOverlayBlocked());
    return null;
  }
  function Background() {
    return React.createElement(React.Fragment, null,
      React.createElement("div", { "data-testid": "background" },
        React.createElement(Input, { label: "Field", value: "text", onChangeText() {} }),
        React.createElement(ThemedScrollView, null, React.createElement("span", null, "scroll body")),
        React.createElement(ThemedFlatList, {
          data: [],
          renderItem: () => null,
          keyExtractor: () => "",
        })),
      React.createElement(ActivityProbe),
      React.createElement(LegacyProbe),
      React.createElement(BlockedProbe));
  }

  let setOpen;
  function Scene() {
    const [open, setOpenState] = React.useState(false);
    setOpen = setOpenState;
    const background = React.useMemo(() => React.createElement(Background), []);
    return React.createElement(React.Fragment, null,
      background,
      open ? React.createElement(OverlayPortal, { blocking: true, active: true }, React.createElement("div", null, "popup")) : null);
  }

  const { dom, previous } = setupDom();
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(React.createElement(OverlayHost, null, React.createElement(Scene))));
    const before = { ...harness.counts };
    const activityBefore = activityValues.length;
    const legacyBefore = legacyValues.length;
    const blockedBefore = blockedValues.length;
    assert.equal(blockedValues.at(-1), false);
    assert.equal(activityValues.at(-1), true);
    assert.equal(legacyValues.at(-1), true);

    await React.act(() => setOpen(true));
    const opened = {
      input: harness.counts.input - before.input,
      scroll: harness.counts.scroll - before.scroll,
      list: harness.counts.list - before.list,
      activity: activityValues.length - activityBefore,
      legacy: legacyValues.length - legacyBefore,
      blocked: blockedValues.length - blockedBefore,
    };
    assert.equal(blockedValues.at(-1), true, "the blocking context still flips");
    assert.equal(activityValues.at(-1), false, "background animation pause is retained");
    assert.ok(opened.blocked >= 1);
    assert.ok(opened.activity >= 1);
    assert.equal(opened.legacy, 0, "host scope changes must not reconcile legacy provider descendants");
    assert.equal(legacyValues.at(-1), true, "the background legacy activity value stays stable");
    if (platform === "web") {
      const node = dom.window.document.querySelector('[data-testid="background"]');
      let inert = false;
      for (let current = node; current; current = current.parentElement) {
        if (current.inert) { inert = true; break; }
      }
      assert.equal(inert, true, "web keeps the background inert");
      assert.equal(node.closest("[aria-hidden='true']") !== null, true, "web keeps the background hidden");
    }

    if (platform === "web") {
      assert.equal(opened.input, 0, "web Input must not subscribe to overlay blocking");
      assert.equal(opened.scroll, 0, "web ScrollView must not subscribe to overlay blocking");
      assert.equal(opened.list, 0, "web FlatList must not subscribe to overlay blocking");
      assert.equal(harness.latest.scroll, true, "web scrollEnabled is not forced off behind inert");
      assert.equal(harness.latest.list, true);
      assert.equal(dom.window.document.documentElement.style.overflow, "hidden");
    } else {
      assert.equal(opened.input, 1, "native Input still reacts to the blocking gate");
      assert.equal(opened.scroll, 1, "native ScrollView still reacts to the blocking gate");
      assert.equal(opened.list, 1, "native FlatList still reacts to the blocking gate");
      assert.equal(harness.latest.scroll, false, "native still disables background scrolling");
      assert.equal(harness.latest.list, false);
    }

    await React.act(() => setOpen(false));
    if (platform === "web") {
      const node = dom.window.document.querySelector('[data-testid="background"]');
      let inert = false;
      for (let current = node; current; current = current.parentElement) {
        if (current.inert) { inert = true; break; }
      }
      assert.equal(inert, false);
      assert.equal(node.closest("[aria-hidden='true']"), null);
      assert.equal(dom.window.document.documentElement.style.overflow, "");
    } else {
      assert.equal(harness.latest.scroll, true, "native releases scroll when the overlay closes");
      assert.equal(harness.latest.list, true);
    }
    return { opened, counts: { ...harness.counts } };
  } finally {
    await React.act(() => root.unmount());
    teardownDom({ dom, previous });
  }
}

test("web background fields and scrollers ignore blocking overlay publication", async t => {
  const result = await run("web");
  t.diagnostic(`web opened=${JSON.stringify(result.opened)} totals=${JSON.stringify(result.counts)}`);
});

test("native background fields and scrollers keep the blocking gate", async t => {
  const result = await run("android");
  t.diagnostic(`android opened=${JSON.stringify(result.opened)} totals=${JSON.stringify(result.counts)}`);
});
