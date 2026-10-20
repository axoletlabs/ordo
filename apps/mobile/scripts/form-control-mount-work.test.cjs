/** Shared form-control mount work: execute the real components (including the
 * real PressableScale and StateLayer) against a tiny hooks host, and assert
 * how much Reanimated state each control initializes per mount, that a design
 * mode switch never swaps pressable implementations (which would remount a
 * focused or pressed control), and that no JS render path reads a shared value.
 * The counts mirror what Reanimated allocates on first render only, matching
 * real hooks (a re-render does not reallocate a shared value). Run with:
 *   node --test apps/mobile/scripts/form-control-mount-work.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");

// ---------------------------------------------------------------- hooks host
const frameMap = new Map();
const effectsQueue = [];
let activeFrame = null;
let renderDepth = 0;
const counters = { sharedValues: 0, animatedStyles: 0, springs: 0, motionHooks: 0, sharedValueReads: 0, remounts: 0, pressableShapes: [], pressableImplementations: [] };
let themeState = { expressive: true, reducedMotion: false };
const platformState = { OS: "android" };
let pressableScaleType = null;

function hooksFrame(path, type) {
  let frame = frameMap.get(path);
  if (!frame) { frame = { slots: [], cursor: 0, first: true, type }; frameMap.set(path, frame); }
  // A different component function at the same tree position makes React
  // unmount and mount; model that by dropping the hook slots.
  else if (frame.type !== type) { frame.slots = []; frame.cursor = 0; frame.first = true; frame.type = type; counters.remounts++; }
  return frame;
}
const memoWrappers = [];
const react = {
  useState(initial) {
    const index = activeFrame.cursor++;
    const slots = activeFrame.slots;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  },
  useRef(initial) {
    const index = activeFrame.cursor++;
    const slots = activeFrame.slots;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useMemo(fn) { activeFrame.cursor++; return fn(); },
  useCallback(fn) {
    const index = activeFrame.cursor++;
    const slots = activeFrame.slots;
    if (!(index in slots)) slots[index] = fn;
    return slots[index];
  },
  useEffect(fn) { activeFrame.cursor++; effectsQueue.push(fn); },
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useContext: context => (context && typeof context === "object" && "_current" in context ? context._current : undefined),
  createContext: initial => ({ _current: initial, Provider: "Provider", Consumer: "Consumer" }),
  isValidElement: element => !!element && typeof element === "object" && "type" in element && "props" in element,
  cloneElement: (element, props, ...children) =>
    ({ ...element, props: { ...element.props, ...props, ...(children.length ? { children } : {}) } }),
  memo: component => {
    const memoized = Object.assign(props => {
      if (memoized.last && Object.is(memoized.last.props, props)) return memoized.last.output;
      if (memoized.last && Object.keys(memoized.last.props).length === Object.keys(props).length
        && Object.keys(props).every(key => Object.is(memoized.last.props[key], props[key]))) return memoized.last.output;
      memoized.invocations++;
      const output = component(props);
      memoized.last = { props, output };
      return output;
    }, { last: null, invocations: 0 });
    memoWrappers.push(memoized);
    return memoized;
  },
  Children: {
    map: (children, fn) => {
      if (children == null) return null;
      const array = (Array.isArray(children) ? children : [children]).flat(Infinity)
        .filter(child => child != null && child !== false && child !== true);
      return array.map(fn);
    },
    toArray: children => react.Children.map(children, child => child) ?? [],
    count: children => react.Children.toArray(children).length,
  },
};
react.default = react;

function renderNode(node, path) {
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}/${index}`));
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  if (typeof node.type === "function") {
    if (node.type === pressableScaleType) counters.pressableShapes.push(node.props.shape);
    const frame = hooksFrame(path, node.type);
    const previous = activeFrame;
    activeFrame = frame;
    frame.cursor = 0;
    let output;
    try { output = node.type(node.props); } finally { activeFrame = previous; }
    if (node.type === pressableScaleType) counters.pressableImplementations.push(output.type);
    frame.first = false;
    return renderNode(output, `${path}()`);
  }
  const props = { ...node.props };
  if (typeof props.children === "function") props.children = props.children({ pressed: false, hovered: false, focused: false });
  if (props.children !== undefined) props.children = renderNode(props.children, `${path}/c`);
  return { ...node, props };
}

function mount(component) {
  const path = `root/${component.name ?? Math.random()}`;
  frameMap.clear();
  const render = props => {
    renderDepth++;
    try {
      const tree = renderNode({ type: component, props }, path);
      while (effectsQueue.length) { const cleanup = effectsQueue.shift()(); if (typeof cleanup === "function") effectsQueue.push(cleanup); }
      return tree;
    } finally { renderDepth--; }
  };
  render.label = component.name;
  return render;
}
function counted(render, props) {
  const before = { ...counters };
  const readsBefore = counters.sharedValueReads;
  const remountsBefore = counters.remounts;
  counters.pressableShapes = [];
  counters.pressableImplementations = [];
  const tree = render(props);
  return {
    tree,
    shapes: counters.pressableShapes,
    implementations: counters.pressableImplementations,
    remounts: counters.remounts - remountsBefore,
    sharedValueReads: counters.sharedValueReads - readsBefore,
    delta: {
      sharedValues: counters.sharedValues - before.sharedValues,
      animatedStyles: counters.animatedStyles - before.animatedStyles,
      springs: counters.springs - before.springs,
      motionHooks: counters.motionHooks - before.motionHooks,
    },
  };
}

// ------------------------------------------------------------ module mocks
function sharedValue(value) {
  // Reads outside a UI-thread updater would synchronize JS against the UI
  // runtime; the mount paths under test must not do that.
  const holder = { value };
  return new Proxy(holder, {
    get(target, key) { if (key === "value") counters.sharedValueReads++; return target[key]; },
    set(target, key, next) { target[key] = next; return true; },
  });
}
const reanimatedBase = {
  useSharedValue(value) {
    if (activeFrame?.first) counters.sharedValues++;
    return sharedValue(value);
  },
  useAnimatedStyle(updater) {
    if (activeFrame?.first) counters.animatedStyles++;
    void updater;
    return {};
  },
  useAnimatedProps(updater) {
    if (activeFrame?.first) counters.animatedStyles++;
    void updater;
    return {};
  },
  withSpring(value) { counters.springs++; return value; },
  withTiming: value => value,
  withRepeat: value => value,
  cancelAnimation: () => {},
  Animated: { createAnimatedComponent: type => type, View: "ReAnimatedView" },
  interpolateColor: () => "#000000",
  Easing: { linear: x => x, bezier: () => x => x },
  ReduceMotion: { Never: "never" },
};
const reanimated = { ...reanimatedBase, default: { ...reanimatedBase, ...reanimatedBase.Animated, default: reanimatedBase } };

const PALETTE = Object.fromEntries([
  "onSurface", "onSurfaceVariant", "primary", "onPrimary", "onPrimaryContainer", "secondary", "secondaryContainer",
  "onSecondary", "onSecondaryContainer", "error", "errorContainer", "onError", "onErrorContainer", "outline",
  "outlineVariant", "surface", "surfaceContainer", "surfaceContainerLow", "surfaceContainerHighest", "surfaceContainerHigh",
].map(role => [role, "#123456"]));

const MOTION_CONFIGS = {
  effectsFast: { id: "effects.fast" },
  standardFast: { id: "standard.fast" },
  expressiveFast: { id: "expressive.fast" },
};
const modules = new Map();
function mockFor(resolved) {
  const base = resolved.slice(sourceRoot.length);
  if (base === "/components/ui/Text.tsx") return { Text: "Text" };
  if (base === "/components/ui/MaterialIcon.tsx") return { MaterialIcon: Object.assign(() => null, { glyphMap: {} }) };
  if (base === "/components/ui/Spinner.tsx") return { Spinner: "Spinner", spinnerExtent: () => 20 };
  if (base === "/theme/ThemeProvider.tsx") return { useTheme: () => ({ palette: PALETTE, expressive: themeState.expressive }) };
  if (base === "/theme/material-motion.ts") return {
    // Real materialMotion hands out stable module-const spring configs; the
    // components' previous-spring bail-outs depend on that identity.
    materialMotion: { effects: { fast: MOTION_CONFIGS.effectsFast } },
    useMaterialMotion: () => {
      if (activeFrame?.first) counters.motionHooks++;
      return {
        fast: themeState.expressive ? MOTION_CONFIGS.expressiveFast : MOTION_CONFIGS.standardFast,
        expressive: themeState.expressive,
        reducedMotion: themeState.reducedMotion,
      };
    },
  };
  if (base === "/theme/tokens.ts") return {
    radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, full: 9999 },
    spacing: new Proxy({}, { get: () => 8 }),
    layout: {},
    timing: { normal: 200, slow: 300 },
  };
  if (base.startsWith("/lib/haptics.")) return { haptics: { selection() {}, light() {}, warning() {} } };
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
  const localRequire = name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
    if (name === "react-native") return {
      Platform: platformState, View: "View", Pressable: "Pressable", AppState: { currentState: "active" },
      StyleSheet: {
        create: x => x,
        flatten: style => (Array.isArray(style) ? Object.assign({}, ...style.map(s => s && typeof s === "object" ? s : {})) : style ?? undefined),
        hairlineWidth: 1, absoluteFill: {},
      },
      Animated: { View: "RNAnimatedView", createAnimatedComponent: type => type, Value: class {}, spring: () => ({ start() {}, stop() {} }) },
      useWindowDimensions: () => ({ width: 800, height: 600, fontScale: 1 }),
    };
    if (name === "react-native-reanimated") return reanimated;
    if (name === "react-native-gesture-handler") return { Pressable: "GesturePressable" };
    if (name === "react-native-svg") return { default: "Svg", Svg: "Svg", Path: "Path", Circle: "Circle", G: "G" };
    if (name.startsWith(".")) return load(resolveModule(dirname(filename), name));
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
  return mod.exports;
}
const ui = name => load(resolve(sourceRoot, "components/ui", name));
pressableScaleType = ui("PressableScale.tsx").PressableScale;

// ------------------------------------------------------------------ tests
const FOUR_OPTIONS = [
  { value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }, { value: "d", label: "Delta" },
];

test("Standard-mode icon buttons and buttons pass a non-morphing shape without mount springs", () => {
  themeState = { expressive: false, reducedMotion: false };
  const icon = counted(mount(ui("IconButton.tsx").IconButton), { name: "close", onPress: () => {} });
  // Standard keeps the animated pressable on purpose: PressableScale selects
  // its implementation from the presence of `shape`, and a mode switch must not
  // swap implementations (that would remount focused/pressed controls).
  assert.deepEqual(icon.delta, { sharedValues: 4, animatedStyles: 4, springs: 0, motionHooks: 1 });
  assert.deepEqual(icon.shapes, [{ rest: 20, pressed: 20 }], "the capsule keeps its resting corners");
  assert.equal(icon.implementations.length, 1);
  const button = counted(mount(ui("Button.tsx").Button), { label: "Save", onPress: () => {} });
  assert.deepEqual(button.delta, { sharedValues: 4, animatedStyles: 4, springs: 0, motionHooks: 1 });
  assert.equal(button.shapes[0].rest, button.shapes[0].pressed, "the pressed shape does not morph");
  assert.equal(button.implementations.length, 1);
});

test("Theme mode switches keep the same pressable implementation (no remount)", () => {
  const cases = [
    [mount(ui("IconButton.tsx").IconButton), { name: "close", onPress: () => {} }, 1],
    [mount(ui("Button.tsx").Button), { label: "Save", onPress: () => {} }, 1],
    [mount(ui("Segmented.tsx").Segmented), { options: FOUR_OPTIONS, value: "a", onChange: () => {} }, 4],
    // A control without an explicit shape stays on the plain pressable; its
    // implementation must also survive mode switches.
    [mount(ui("Toggle.tsx").Toggle), { value: true, onValueChange: () => {} }, 1],
  ];
  for (const [render, props, count] of cases) {
    themeState = { expressive: false, reducedMotion: false };
    const standard = counted(render, props);
    assert.equal(standard.implementations.length, count, `${render.label} resolves ${count} pressable(s)`);
    const identity = standard.implementations.slice();
    for (const expressive of [true, false, true]) {
      themeState = { expressive, reducedMotion: false };
      const switched = counted(render, props);
      // Same component function at the same position: React updates in place
      // instead of unmounting, so focus/press/hover state survives the switch.
      assert.deepEqual(switched.implementations, identity, `${render.label}: ${expressive ? "Expressive" : "Standard"} keeps implementation identity`);
      assert.equal(switched.remounts, 0, "no component is unmounted by the mode switch");
      assert.equal(switched.delta.sharedValues, 0, "no hooks are re-created on a mode switch");
      assert.equal(switched.delta.animatedStyles, 0);
      assert.equal(switched.delta.motionHooks, 0);
      assert.equal(switched.sharedValueReads, 0, "a mode switch reads no shared value from JS");
    }
  }
});

function findNode(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findNode(child, predicate); if (found) return found; }
    return null;
  }
  if (!node || typeof node !== "object" || !("type" in node)) return null;
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
}
function pressableOutline(tree) {
  const pressable = findNode(tree, node => typeof node.props?.onFocus === "function" && node.props?.accessibilityRole === "button");
  assert.ok(pressable, "the control exposes a pressable");
  const style = Array.isArray(pressable.props.style)
    ? Object.assign({}, ...pressable.props.style.flat(Infinity).filter(entry => entry && typeof entry === "object")) : pressable.props.style;
  return style.outlineWidth;
}

test("Focus survives a theme mode switch instead of remounting the pressable", () => {
  const previousPlatform = platformState.OS;
  // Web exposes the focus-visible outline in the rendered style, so the test
  // can observe live focus state rather than inferred implementation identity.
  platformState.OS = "web";
  try {
    for (const [render, props] of [
      [mount(ui("IconButton.tsx").IconButton), { name: "close", onPress: () => {} }],
      [mount(ui("Button.tsx").Button), { label: "Save", onPress: () => {} }],
    ]) {
      themeState = { expressive: false, reducedMotion: false };
      const resting = counted(render, props);
      assert.equal(pressableOutline(resting.tree), undefined, "an unfocused control paints no outline");
      const pressable = findNode(resting.tree, node => typeof node.props?.onFocus === "function" && node.props?.accessibilityRole === "button");
      pressable.props.onFocus({ currentTarget: { matches: () => true } });
      assert.equal(pressableOutline(counted(render, props).tree), 3, "focus-visible paints the 3dp outline");
      themeState = { expressive: true, reducedMotion: false };
      const switched = counted(render, props);
      assert.equal(pressableOutline(switched.tree), 3, "focus is retained across the mode switch");
    }
  } finally { platformState.OS = previousPlatform; }
});

test("Expressive icon buttons and buttons keep the pressed corner morph", () => {
  themeState = { expressive: true, reducedMotion: false };
  const icon = counted(mount(ui("IconButton.tsx").IconButton), { name: "close", onPress: () => {} });
  assert.equal(icon.shapes[0].rest, 20);
  assert.equal(icon.shapes[0].pressed, 8);
  assert.ok(icon.delta.sharedValues > 0 && icon.delta.animatedStyles > 0, "the morph still owns shared values");
  const button = counted(mount(ui("Button.tsx").Button), { label: "Save", onPress: () => {} });
  assert.notEqual(button.shapes[0].rest, button.shapes[0].pressed, "the pressed shape is visibly squarer");
  assert.ok(button.delta.sharedValues > 0);
});

test("Standard-mode segmented groups keep the plain outline shape and skip reselect reallocations", () => {
  themeState = { expressive: false, reducedMotion: false };
  frameMap.clear();
  const segmented = mount(ui("Segmented.tsx").Segmented);
  const first = counted(segmented, { options: FOUR_OPTIONS, value: "a", onChange: () => {} });
  // 4 pressables × 4 + 4 labels × 2 = 24. The pressables stay animated so the
  // Expressive/Standard switch never replaces them.
  assert.equal(first.delta.sharedValues, 24);
  assert.equal(first.delta.animatedStyles, 24);
  assert.equal(first.delta.motionHooks, 5, "one group subscription, one per pressable");
  assert.equal(first.shapes.length, 4);
  // Standard keeps the outer capsule ends at 20dp and square interior corners;
  // either way rest and pressed are identical, so nothing morphs on press.
  assert.deepEqual(first.shapes[0].rest, { topLeft: 20, topRight: 0, bottomLeft: 20, bottomRight: 0 });
  assert.deepEqual(first.shapes[3].rest, { topLeft: 0, topRight: 20, bottomLeft: 0, bottomRight: 20 });
  for (const shape of first.shapes) assert.deepEqual(shape.pressed, shape.rest);
  const reselect = counted(segmented, { options: FOUR_OPTIONS, value: "b", onChange: () => {} });
  assert.equal(reselect.delta.sharedValues, 0, "selection changes allocate nothing");
  assert.equal(reselect.delta.springs, 6, "two labels spring tint/check and two segment backgrounds tint");
});

test("Expressive segmented groups keep per-segment shape morphing and skip re-allocation", () => {
  themeState = { expressive: true, reducedMotion: false };
  frameMap.clear();
  const segmented = mount(ui("Segmented.tsx").Segmented);
  const first = counted(segmented, { options: FOUR_OPTIONS, value: "a", onChange: () => {} });
  assert.equal(first.delta.sharedValues, 24, "4 pressables × 4 + 4 labels × 2");
  assert.equal(first.delta.motionHooks, 5, "one group subscription plus one per animated pressable");
  assert.ok(first.shapes.every(shape => shape && shape.rest !== shape.pressed));
  const reselect = counted(segmented, { options: FOUR_OPTIONS, value: "b", onChange: () => {} });
  assert.equal(reselect.delta.sharedValues, 0);
  assert.equal(reselect.delta.springs, 6, "two labels spring tint/check and two segments spring corners");
});

test("Reduced-motion segmented groups set selection directly without springs", () => {
  themeState = { expressive: true, reducedMotion: true };
  frameMap.clear();
  const segmented = mount(ui("Segmented.tsx").Segmented);
  counted(segmented, { options: FOUR_OPTIONS, value: "a", onChange: () => {} });
  const reselect = counted(segmented, { options: FOUR_OPTIONS, value: "b", onChange: () => {} });
  assert.equal(reselect.delta.springs, 0);
});

test("Segmented hidden measuring labels do not re-render on selection changes", () => {
  themeState = { expressive: true, reducedMotion: false };
  const segmented = mount(ui("Segmented.tsx").Segmented);
  segmented({ options: FOUR_OPTIONS, value: "a", onChange: () => {} });
  const wrapper = memoWrappers.find(memo => memo.invocations > 0);
  assert.ok(wrapper, "harness sees the measuring row render");
  const afterFirst = wrapper.invocations;
  segmented({ options: FOUR_OPTIONS, value: "b", onChange: () => {} });
  assert.equal(wrapper.invocations, afterFirst, "the memoized row keeps its output across selection changes");
});

test("Button groups keep one motion subscription and spring only width changes", () => {
  themeState = { expressive: true, reducedMotion: false };
  frameMap.clear();
  const group = mount(ui("ButtonGroup.tsx").ButtonGroup);
  const children = ["a", "b", "c"].map(key => ({ type: "View", props: { key } }));
  const mountResult = counted(group, { children });
  assert.equal(mountResult.delta.motionHooks, 1, "the group is the only motion subscriber");
  assert.equal(mountResult.delta.sharedValues, 3, "one width shared value per item");
  const idle = counted(group, { children });
  assert.equal(idle.delta.springs, 0, "unchanged widths bail before springing");
});

test("The Material switch keeps exactly its four load-bearing shared values", () => {
  themeState = { expressive: true, reducedMotion: false };
  const toggle = counted(mount(ui("Toggle.tsx").Toggle), { value: true, onValueChange: () => {} });
  assert.deepEqual(toggle.delta, { sharedValues: 4, animatedStyles: 4, springs: 0, motionHooks: 1 });
});

test("No control reads a shared value synchronously from JavaScript while mounting", () => {
  for (const expressive of [true, false]) {
    themeState = { expressive, reducedMotion: false };
    const cases = [
      [mount(ui("IconButton.tsx").IconButton), { name: "close", onPress: () => {} }],
      [mount(ui("Button.tsx").Button), { label: "Save", onPress: () => {} }],
      [mount(ui("Segmented.tsx").Segmented), { options: FOUR_OPTIONS, value: "a", onChange: () => {} }],
      [mount(ui("ButtonGroup.tsx").ButtonGroup), { children: [{ type: "View", props: {} }] }],
      [mount(ui("Toggle.tsx").Toggle), { value: true, onValueChange: () => {} }],
      [mount(ui("LinearProgress.tsx").LinearProgress), { value: 0.5, label: "Downloading" }],
    ];
    for (const [render, props] of cases) {
      const result = counted(render, props);
      assert.equal(result.sharedValueReads, 0, "mount must not read shared values from JS");
    }
  }
});

test("LinearProgress keeps its segment math after the module-scope geometry extraction", () => {
  themeState = { expressive: true, reducedMotion: false };
  const progress = mount(ui("LinearProgress.tsx").LinearProgress);
  const tree = progress({ value: 0.5, label: "Downloading" });
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes("material-linear-progress"));
  const source = readFileSync(resolve(sourceRoot, "components/ui/LinearProgress.tsx"), "utf8");
  assert.match(source, /^function progressGeometry\(/m, "geometry stays a module-scope worklet");
  assert.doesNotMatch(source, /const geometry = \(\) =>/, "no render-scope worklet helper is recaptured per render");
});
