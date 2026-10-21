/** Execute the REAL PressableScale/ListPressable/RowHighlight against a small
 * hooks host and assert the shared interaction contract that keeps the app
 * free of square feedback flashes and redundant row work:
 *   - a plain (menu/list) pressable costs no Reanimated graph and no style
 *     flatten until feedback actually paints,
 *   - a shape's resting silhouette is painted before the animated corner value
 *     can land (never a one-frame square),
 *   - button press morphs stay interruptible and settle directly under reduced
 *     motion,
 *   - rows that own their full-bleed highlight don't mount a second hover
 *     state machine,
 *   - a context-menu highlight lands with the palette handoff (no frame where
 *     the selected text and tonal surface disagree), while a real selection
 *     still fades.
 * Run with: node --test apps/mobile/scripts/pressable-shape-feedback.test.cjs */
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
const counters = { sharedValues: 0, animatedStyles: 0, springs: 0, flatten: 0, reads: 0 };
let themeState = { expressive: true, reducedMotion: false };
const platformState = { OS: "web" };
let pressableState = { pressed: false, hovered: false, focused: false };

function hooksFrame(path, type) {
  let frame = frameMap.get(path);
  if (!frame) { frame = { slots: [], cursor: 0, first: true, type }; frameMap.set(path, frame); }
  else if (frame.type !== type) { frame.slots = []; frame.cursor = 0; frame.first = true; frame.type = type; }
  return frame;
}
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
  useLayoutEffect(fn) { activeFrame.cursor++; effectsQueue.push(fn); },
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useContext: context => (context && typeof context === "object" && "_current" in context ? context._current : undefined),
  createContext: initial => ({ _current: initial, Provider: "Provider", Consumer: "Consumer" }),
  isValidElement: element => !!element && typeof element === "object" && "type" in element && "props" in element,
  memo: component => props => component(props),
  Children: {
    map: (children, fn) => children == null ? null : (Array.isArray(children) ? children : [children]).flat(Infinity)
      .filter(child => child != null && child !== false && child !== true).map(fn),
    toArray: children => react.Children.map(children, child => child) ?? [],
    count: children => react.Children.toArray(children).length,
  },
};
react.default = react;
function renderNode(node, path) {
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}/${index}`));
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  if (typeof node.type === "function") {
    const frame = hooksFrame(path, node.type);
    const previous = activeFrame;
    activeFrame = frame;
    frame.cursor = 0;
    let output;
    try { output = node.type(node.props); } finally { activeFrame = previous; }
    frame.first = false;
    return renderNode(output, `${path}()`);
  }
  const props = { ...node.props };
  if (typeof props.children === "function") props.children = props.children(pressableState);
  if (props.children !== undefined) props.children = renderNode(props.children, `${path}/c`);
  return { ...node, props };
}
function mount(component) {
  const path = `root/${component.name ?? Math.random()}`;
  frameMap.clear();
  pressableState = { pressed: false, hovered: false, focused: false };
  const render = props => {
    const tree = renderNode({ type: component, props }, path);
    while (effectsQueue.length) { const cleanup = effectsQueue.shift()(); if (typeof cleanup === "function") effectsQueue.push(cleanup); }
    return tree;
  };
  render.label = component.name;
  return render;
}
function counted(render, props) {
  const before = { ...counters };
  const tree = render(props);
  return { tree, delta: { sharedValues: counters.sharedValues - before.sharedValues,
    animatedStyles: counters.animatedStyles - before.animatedStyles,
    springs: counters.springs - before.springs, flatten: counters.flatten - before.flatten,
    reads: counters.reads - before.reads } };
}
function findNodes(node, predicate, found = []) {
  if (Array.isArray(node)) { for (const child of node) findNodes(child, predicate, found); return found; }
  if (!node || typeof node !== "object" || !("type" in node)) return found;
  if (predicate(node)) found.push(node);
  findNodes(node.props?.children, predicate, found);
  return found;
}
const firstNode = (tree, predicate) => findNodes(tree, predicate)[0];
function flatStyle(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.flat(Infinity)
    .filter(entry => entry && typeof entry === "object" && !entry.__animatedStyle));
  return style && typeof style === "object" && !style.__animatedStyle ? style : {};
}
function styleEntries(style) { return (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean); }
/** Merge static entries and evaluate animated updaters, matching what the
 * renderer paints after Reanimated lands its first value. */
function liveStyle(style) {
  const flat = {};
  for (const entry of styleEntries(style)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.__animatedStyle) Object.assign(flat, entry.__animatedStyle());
    else Object.assign(flat, entry);
  }
  return flat;
}

// ------------------------------------------------- animated algebra evaluator
class MockValue {
  constructor(value) { this._value = value; }
  get value() { return this._value; }
  set value(next) { counters.reads++; this._value = next; }
  interpolate(config) {
    return {
      __interpolate: true, source: this, config,
      evaluate: () => {
        const value = this._value;
        const { inputRange, outputRange } = config;
        if (value <= inputRange[0]) return outputRange[0];
        if (value >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1];
        for (let index = 0; index < inputRange.length - 1; index++) {
          if (value >= inputRange[index] && value <= inputRange[index + 1]) {
            const t = (value - inputRange[index]) / (inputRange[index + 1] - inputRange[index]);
            return outputRange[index] + (outputRange[index + 1] - outputRange[index]) * t;
          }
        }
        return outputRange[0];
      },
    };
  }
  stopAnimation() {}
  setValue(next) { this._value = next; }
}
const animatedApi = {
  Value: MockValue,
  View: "RNAnimatedView",
  createAnimatedComponent: type => type,
  spring: (value, config) => {
    counters.springs++;
    return { start() { value.setValue(config.toValue); }, stop() {} };
  },
};
function resolveStyleValue(value) {
  if (value && typeof value === "object" && value.__interpolate) return value.evaluate();
  return value;
}
function resolvedCorners(style) {
  const flat = liveStyle(style);
  return ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]
    .map(key => resolveStyleValue(flat[key]));
}
function staticCorners(style) {
  const flat = flatStyle(style);
  return ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]
    .map(key => flat[key]);
}

// ------------------------------------------------------------ module mocks
function sharedValue(value) {
  counters.sharedValues++;
  return new Proxy({ value }, {
    get(target, key) { if (key === "value") counters.reads++; return target[key]; },
    set(target, key, next) { target[key] = next; return true; },
  });
}
const reanimated = {
  useSharedValue: value => sharedValue(value),
  useAnimatedStyle(updater) {
    counters.animatedStyles++;
    return { __animatedStyle: updater };
  },
  withSpring(value) { counters.springs++; return value; },
  withTiming: value => value,
  cancelAnimation: () => {},
  Animated: { createAnimatedComponent: type => type, View: "ReAnimatedView" },
  Easing: { linear: x => x, bezier: () => x => x },
  ReduceMotion: { Never: "never" },
};
reanimated.default = { ...reanimated, ...reanimated.Animated, default: reanimated };

const PALETTE = Object.fromEntries([
  "onSurface", "onSurfaceVariant", "primary", "onPrimary", "secondary", "secondaryContainer",
  "onSecondary", "onSecondaryContainer", "tertiaryContainer", "onTertiaryContainer",
  "error", "outline", "outlineVariant", "surface", "surfaceContainerLow",
].map(role => [role, "#123456"]));
const MOTION = { id: "motion.fast" };
const modules = new Map();
function mockFor(resolved) {
  const base = resolved.slice(sourceRoot.length);
  if (base === "/components/ui/Text.tsx") return { Text: "Text" };
  if (base === "/components/ui/ButtonGroup.tsx") return { useButtonGroupInteraction: () => null };
  if (base === "/theme/ThemeProvider.tsx") return { useTheme: () => ({ palette: PALETTE, expressive: themeState.expressive }) };
  if (base === "/theme/material-motion.ts") return {
    materialMotion: { effects: { fast: MOTION } },
    useMaterialMotion: () => ({ fast: MOTION, spatial: MOTION, slow: MOTION, expressive: themeState.expressive, reducedMotion: themeState.reducedMotion }),
  };
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
      Platform: Object.assign(platformState, { select: choices => choices[platformState.OS] ?? choices.default }),
      View: "View", Pressable: "Pressable", TextInput: "TextInput", AppState: { currentState: "active" },
      StyleSheet: {
        create: x => x,
        flatten: style => {
          counters.flatten++;
          return Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)
            .filter(entry => entry && typeof entry === "object" && !entry.__animatedStyle)) : style ?? undefined;
        },
        hairlineWidth: 1, absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      },
      Animated: animatedApi,
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

const menuItemProps = {
  accessibilityRole: "menuitem",
  stateLayerColor: "#123456",
  onPress: () => {},
  style: [{ minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
    { borderRadius: 12, backgroundColor: "transparent" }],
  children: "Edit tags",
};

test("a plain menu row mounts no Reanimated graph, no style flatten, no state-layer fiber", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  const { tree, delta } = counted(render, menuItemProps);
  assert.deepEqual(delta, { sharedValues: 0, animatedStyles: 0, springs: 0, flatten: 0, reads: 0 },
    "the common action-row path performs no animation or paint prep before feedback");
  assert.equal(firstNode(tree, node => node.props?.testID === "material-state-layer"), undefined,
    "an untouched row does not mount an invisible layer fiber");
  const pressable = firstNode(tree, node => typeof node.props?.onPressIn === "function");
  assert.equal(pressable.props.dataSet.materialHoverSurface, "true", "nested actions still own their hover");
  assert.equal(pressable.props["aria-disabled"], undefined);
});

test("a nine-item action menu mounts without any feedback prep work", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const PressableScale = ui("PressableScale.tsx").PressableScale;
  function MenuRows() {
    return Array.from({ length: 9 }, (_, index) => ({ type: PressableScale, key: index,
      props: { ...menuItemProps, children: `Action ${index}` } }));
  }
  const { tree, delta } = counted(mount(MenuRows), {});
  assert.deepEqual(delta, { sharedValues: 0, animatedStyles: 0, springs: 0, flatten: 0, reads: 0 });
  assert.equal(findNodes(tree, node => node.props?.testID === "material-state-layer").length, 0,
    "nine untouched menu rows mount zero layer fibers");
});

test("the first touch on a cold native action paints press feedback without hover or focus", () => {
  platformState.OS = "android";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  render(menuItemProps);
  pressableState = { pressed: true, hovered: false, focused: false };
  const pressed = render(menuItemProps);
  const layer = firstNode(pressed, node => node.props?.testID === "material-state-layer");
  assert.ok(layer, "a touch-only press mounts its ink even without a hover/focus render");
  assert.equal(flatStyle(layer.props.style).backgroundColor, "#1234561a");
  pressableState = { pressed: false, hovered: false, focused: false };
  assert.ok(firstNode(render(menuItemProps), node => node.props?.testID === "material-state-layer"),
    "release retains the layer for its exit fade");
});

test("hover and focus mount one shared layer and paint the Material fractions", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  render(menuItemProps);
  const pressable = () => firstNode(render(menuItemProps), node => typeof node.props?.onHoverIn === "function");
  pressable().props.onHoverIn({});
  const hovered = render(menuItemProps);
  const layer = firstNode(hovered, node => node.props?.testID === "material-state-layer");
  assert.ok(layer, "the layer mounts on first feedback");
  assert.equal(flatStyle(layer.props.style).backgroundColor, "#12345614", "hover bakes 8% ink into the fill");
  pressable().props.onFocus({ currentTarget: { matches: () => true } });
  const focused = render(menuItemProps);
  const focusLayer = firstNode(focused, node => node.props?.testID === "material-state-layer");
  assert.equal(flatStyle(focusLayer.props.style).backgroundColor, "#1234561a", "focus uses the 10% fraction");
  pressable().props.onHoverOut({});
  pressable().props.onBlur({});
  const resting = render(menuItemProps);
  const restingLayer = firstNode(resting, node => node.props?.testID === "material-state-layer");
  assert.ok(restingLayer, "the layer is retained so release keeps its fade");
});

test("disabled rows never mount feedback and expose aria-disabled", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  render({ ...menuItemProps, disabled: true });
  const tree = render({ ...menuItemProps, disabled: true });
  assert.equal(firstNode(tree, node => node.props?.testID === "material-state-layer"), undefined);
  const pressable = firstNode(tree, node => typeof node.props?.onHoverIn === "function");
  assert.equal(pressable.props["aria-disabled"], true);
  assert.equal(pressable.props.accessibilityState, undefined);
});

test("a shape-only surface paints its resting corners before the live value lands", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  const props = { shape: { rest: 20, pressed: 8 }, accessibilityRole: "button", stateLayerColor: "#123456",
    style: [{ minHeight: 48, justifyContent: "center" }], children: "Button" };
  const { tree } = counted(render, props);
  const layer = firstNode(tree, node => node.props?.testID === "material-state-layer");
  assert.deepEqual(resolvedCorners(layer.props.style), [20, 20, 20, 20],
    "the layer falls back to the shape's rest corners, never a square");
  assert.deepEqual(staticCorners(layer.props.style), [20, 20, 20, 20],
    "the fallback is a static style entry, so it paints without waiting for the mapper");
  const pressable = firstNode(tree, node => typeof node.props?.onPressIn === "function");
  assert.deepEqual(resolvedCorners(pressable.props.style), [20, 20, 20, 20],
    "the painted host also carries the static rest shape");
});

test("a segmented-style surface without a style radius paints its group corners statically", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  const props = { shape: { rest: { topLeft: 20, topRight: 8, bottomLeft: 20, bottomRight: 8 },
      pressed: { topLeft: 20, topRight: 4, bottomLeft: 20, bottomRight: 4 } },
    accessibilityRole: "radio", stateLayerColor: "#123456",
    // Expressive connected segments intentionally omit a border radius from
    // visualStyle; the shape prop is the only source of their silhouette.
    style: [{ flex: 1, minHeight: 48 }], visualStyle: [{ minHeight: 40, backgroundColor: "#654321" }], children: "Option" };
  const { tree } = counted(render, props);
  const surface = firstNode(tree, node => node.props?.testID === "material-visual-surface");
  assert.ok(surface, "the painted sub-surface exists");
  assert.deepEqual(staticCorners(surface.props.style), [20, 8, 20, 8],
    "the painted surface carries the group silhouette before the animated value");
  const layer = firstNode(tree, node => node.props?.testID === "material-state-layer");
  assert.deepEqual(staticCorners(layer.props.style), [20, 8, 20, 8],
    "hover/press ink follows the same static silhouette");
});

test("pressing a shaped control springs to the pressed corners and release returns", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  const props = { shape: { rest: 20, pressed: 8 }, accessibilityRole: "button", stateLayerColor: "#123456",
    style: [{ minHeight: 48, justifyContent: "center" }], children: "Button" };
  render(props);
  const pressable = () => firstNode(render(props), node => typeof node.props?.onPressIn === "function");
  const before = counters.springs;
  pressable().props.onPressIn({});
  const pressed = render(props);
  assert.ok(counters.springs > before, "press starts interruptible springs");
  const corners = resolvedCorners(firstNode(pressed, node => node.props?.testID === "material-state-layer").props.style);
  assert.deepEqual(corners, [8, 8, 8, 8], "the river reaches the pressed shape");
  let release = null;
  const original = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = callback => { release = callback; return 1; };
  global.cancelAnimationFrame = () => {};
  try {
    pressable().props.onPressOut({});
    // onPressOut scheduled the release frame in the previous render.
    const afterOut = render(props);
    assert.equal(typeof release, "function", "release is deferred one frame for a toggle commit");
    release();
    const released = render(props);
    assert.deepEqual(resolvedCorners(firstNode(released, node => node.props?.testID === "material-state-layer").props.style),
      [20, 20, 20, 20]);
  } finally {
    global.requestAnimationFrame = original;
    global.cancelAnimationFrame = originalCancel;
  }
});

test("an animated style host without scale feedback skips the unused progress graph", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  const props = { animated: true, shape: { rest: 20, pressed: 12 }, accessibilityRole: "button",
    stateLayerColor: "#123456", style: [{ minHeight: 48, justifyContent: "center" }], children: "FAB" };
  const first = counted(render, props);
  assert.equal(first.delta.sharedValues, 3, "only layer, background and corners remain");
  assert.equal(first.delta.animatedStyles, 3);
  const before = counters.springs;
  firstNode(render(props), node => typeof node.props?.onPressIn === "function").props.onPressIn({});
  render(props);
  assert.equal(counters.springs - before, 2, "press runs the layer and corner springs, not a no-op scale");
});

test("reduced motion settles press and release without springs", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: true };
  const render = mount(ui("PressableScale.tsx").PressableScale);
  const props = { shape: { rest: 20, pressed: 8 }, accessibilityRole: "button", stateLayerColor: "#123456",
    style: [{ minHeight: 48, justifyContent: "center" }], children: "Button" };
  render(props);
  const before = counters.springs;
  firstNode(render(props), node => typeof node.props?.onPressIn === "function").props.onPressIn({});
  const pressed = render(props);
  assert.equal(counters.springs - before, 0, "no spring is created under reduced motion");
  assert.deepEqual(resolvedCorners(firstNode(pressed, node => node.props?.testID === "material-state-layer").props.style),
    [8, 8, 8, 8]);
});

test("Space activates selection roles once, unless the caller handles the key", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  let presses = 0;
  const render = mount(ui("PressableScale.tsx").PressableScale);
  const props = { accessibilityRole: "checkbox", onPress: () => { presses += 1; }, style: { minHeight: 48 }, children: "Check" };
  render(props);
  const pressable = firstNode(render(props), node => typeof node.props?.onKeyDown === "function");
  let prevented = 0;
  const event = () => {
    const value = { key: " ", target: pressable.props, currentTarget: pressable.props, defaultPrevented: false,
      preventDefault: () => { prevented += 1; value.defaultPrevented = true; } };
    return value;
  };
  pressable.props.onKeyDown(event());
  assert.equal(presses, 1);
  assert.equal(prevented, 1);
  pressable.props.onKeyDown({ ...event(), repeat: true });
  assert.equal(presses, 1, "key repeat never re-triggers");
  pressable.props.onKeyDown({ ...event(), target: {} });
  assert.equal(presses, 1, "a nested target keeps its own key behaviour");
  pressable.props.onKeyDown({ ...event(), defaultPrevented: true });
  assert.equal(presses, 1, "a handled key is not replayed");
  let handled = 0;
  const handledRender = mount(ui("PressableScale.tsx").PressableScale);
  const handledProps = { ...props, onKeyDown: (key) => { handled += 1; key.preventDefault(); } };
  handledRender(handledProps);
  const handledPressable = firstNode(handledRender(handledProps),
    node => typeof node.props?.onKeyDown === "function");
  handledPressable.props.onKeyDown({ key: " ", target: handledPressable.props, currentTarget: handledPressable.props, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; } });
  assert.equal(handled, 1);
  assert.equal(presses, 1, "the caller's prevented key does not also activate");
});

test("ListPressable with row-owned feedback skips hover work but keeps the focus ring", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("ListPressable.tsx").ListPressable);
  const userHover = () => {};
  const props = { feedback: false, accessibilityRole: "button", onHoverIn: userHover,
    style: [{ minHeight: 72 }, { borderRadius: 0 }], children: "Row" };
  const first = counted(render, props);
  assert.equal(first.delta.flatten, 0, "no flatten when the row owns its highlight");
  assert.equal(firstNode(first.tree, node => node.props?.testID === "material-list-state-layer"), undefined);
  const pressable = firstNode(first.tree, node => typeof node.props?.onFocus === "function");
  assert.equal(pressable.props.onHoverIn, userHover, "the caller's hover handler passes through untouched");
  pressable.props.onFocus({ currentTarget: { matches: () => true } });
  const focused = firstNode(render(props), node => typeof node.props?.onFocus === "function");
  const focusedStyle = flatStyle(focused.props.style({ pressed: false }));
  assert.equal(focusedStyle.outlineWidth, 2, "keyboard focus still paints the bounded row ring");
  assert.equal(focusedStyle.outlineOffset, -2, "the ring stays inside the row");
});

test("ListPressable feedback mounts one layer and fades on hover", () => {
  platformState.OS = "web";
  themeState = { expressive: true, reducedMotion: false };
  const render = mount(ui("ListPressable.tsx").ListPressable);
  const props = { accessibilityRole: "button", style: [{ minHeight: 72 }, { borderRadius: 8 }], children: "Row" };
  render(props);
  const pressable = () => firstNode(render(props), node => typeof node.props?.onHoverIn === "function");
  pressable().props.onHoverIn({});
  const tree = render(props);
  const layer = firstNode(tree, node => node.props?.testID === "material-list-state-layer");
  assert.ok(layer);
  assert.equal(flatStyle(layer.props.style).backgroundColor, "#12345614");
  assert.deepEqual(resolvedCorners(layer.props.style), [8, 8, 8, 8]);
  pressable().props.onBlur({});
  pressable().props.onHoverOut({});
});

test("a context-menu highlight lands with the palette handoff; a selection still fades", () => {
  platformState.OS = "web";
  const RowHighlight = load(resolve(sourceRoot, "components/bookmarks/RowHighlight.tsx")).RowHighlight;
  const rest = { borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 };
  const render = mount(RowHighlight);
  render({ rest, expressive: true, hovered: false, pressed: false, selected: false, highlighted: false });
  const before = counters.springs;
  const opening = render({ rest, expressive: true, hovered: false, pressed: false, selected: false, highlighted: true });
  const selection = firstNode(opening, node => node.props?.testID === "material-row-selection");
  assert.equal(selection.props.style.at(-1).opacity.value, 1, "the tonal surface is fully present on the trigger commit");
  assert.equal(counters.springs - before, 0, "the trigger handoff does not animate behind the palette flip");
  assert.deepEqual(resolvedCorners(selection.props.style), [20, 20, 20, 20], "the held row shape lands with it");
  const closing = render({ rest, expressive: true, hovered: false, pressed: false, selected: false, highlighted: false });
  assert.equal(firstNode(closing, node => node.props?.testID === "material-row-selection").props.style.at(-1).opacity.value, 0);
  const selectionStart = counters.springs;
  const toggled = render({ rest, expressive: true, hovered: false, pressed: false, selected: true, highlighted: false });
  assert.ok(counters.springs - selectionStart > 0, "a real selection keeps its fade");
  assert.deepEqual(resolvedCorners(firstNode(toggled, node => node.props?.testID === "material-row-selection").props.style),
    [20, 20, 20, 20]);
});
