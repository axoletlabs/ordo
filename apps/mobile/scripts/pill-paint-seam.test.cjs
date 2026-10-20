/** Stretchable pill paint + shared state-layer fade: execute the REAL
 * components (StretchablePill -> PressableScale) against the mount-work host
 * and assert the compositing contract that keeps the selection toolbar free
 * of hairline cutlines and hover slivers:
 *   - the opaque surface's middle bleeds under both end caps,
 *   - translucent overlay parts keep exact abutment (stacked alpha would
 *     double-tint the seams),
 *   - caps overpaint the middle (DOM order),
 *   - the state layer's fade lives in each part's fill color, never in a
 *     sub-1 element opacity (a compositor group that drifts off its surface).
 * Run with: node --test apps/mobile/scripts/pill-paint-seam.test.cjs */
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
const counters = { sharedValues: 0, animatedStyles: 0, springs: 0, sharedValueReads: 0 };
let themeState = { expressive: true, reducedMotion: false };
const platformState = { OS: "web" };
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
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useContext: context => (context && typeof context === "object" && "_current" in context ? context._current : undefined),
  createContext: initial => ({ _current: initial, Provider: "Provider", Consumer: "Consumer" }),
  isValidElement: element => !!element && typeof element === "object" && "type" in element && "props" in element,
  cloneElement: (element, props, ...children) =>
    ({ ...element, props: { ...element.props, ...props, ...(children.length ? { children } : {}) } }),
  memo: component => props => component(props),
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
  if (typeof props.children === "function") props.children = props.children({ pressed: false, hovered: false, focused: false });
  if (props.children !== undefined) props.children = renderNode(props.children, `${path}/c`);
  return { ...node, props };
}
function mount(component) {
  const path = `root/${component.name ?? Math.random()}`;
  frameMap.clear();
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
  const readsBefore = counters.sharedValueReads;
  const tree = render(props);
  return {
    tree,
    sharedValueReads: counters.sharedValueReads - readsBefore,
    delta: {
      sharedValues: counters.sharedValues - before.sharedValues,
      animatedStyles: counters.animatedStyles - before.animatedStyles,
      springs: counters.springs - before.springs,
    },
  };
}

// ------------------------------------------------- animated algebra evaluator
class MockValue {
  constructor(value) { this.value = value; }
  interpolate(config) { return interpNode(this, config); }
}
function interpNode(source, config) {
  return { __node: "interp", source, config, interpolate(next) { return interpNode(this, next); } };
}
const op = (name) => (...args) => ({ __node: name, args: args.map(a => (typeof a === "number" ? { __node: "const", value: a } : a)) });
const animatedApi = {
  Value: MockValue,
  multiply: op("mul"), divide: op("div"), subtract: op("sub"), add: op("add"),
  View: "RNAnimatedView", createAnimatedComponent: type => type,
};
function evalNode(node) {
  if (!node || typeof node !== "object") return node;
  switch (node.__node) {
    case "const": return node.value;
    case "interp": {
      const v = evalNode(node.source);
      const { inputRange, outputRange } = node.config;
      if (v <= inputRange[0]) return outputRange[0];
      if (v >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1];
      for (let i = 0; i < inputRange.length - 1; i++) {
        if (v >= inputRange[i] && v <= inputRange[i + 1]) {
          const t = (v - inputRange[i]) / (inputRange[i + 1] - inputRange[i]);
          return outputRange[i] + (outputRange[i + 1] - outputRange[i]) * t;
        }
      }
      return outputRange[0];
    }
    case "mul": return node.args.reduce((acc, a) => acc * evalNode(a), 1);
    case "div": return node.args.slice(1).reduce((acc, a) => acc / evalNode(a), evalNode(node.args[0]));
    case "sub": return node.args.slice(1).reduce((acc, a) => acc - evalNode(a), evalNode(node.args[0]));
    case "add": return node.args.slice(1).reduce((acc, a) => acc + evalNode(a), evalNode(node.args[0]));
    default: return node.value;
  }
}

// ------------------------------------------------------------ module mocks
const sharedValueRegistry = [];
const updaters = [];
function sharedValue(value) {
  const holder = { value };
  sharedValueRegistry.push(holder);
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
    // Capture (don't run): tests drive shared values and invoke updaters to
    // observe what the UI thread would paint.
    updaters.push(updater);
    return { __animatedStyle: updater };
  },
  withSpring(value) { counters.springs++; return value; },
  withTiming: value => value,
  cancelAnimation: () => {},
  Animated: { createAnimatedComponent: type => type, View: "ReAnimatedView" },
  Easing: { linear: x => x, bezier: () => x => x },
  ReduceMotion: { Never: "never" },
};
const reanimated = { ...reanimatedBase, default: { ...reanimatedBase, ...reanimatedBase.Animated, default: reanimatedBase } };

const PALETTE = Object.fromEntries([
  "onSurface", "onSurfaceVariant", "primary", "onPrimary", "secondary", "secondaryContainer", "onSecondary", "onSecondaryContainer",
  "error", "errorContainer", "onError", "onErrorContainer", "outline", "outlineVariant", "surface",
  "surfaceContainerHigh", "surfaceContainerLow", "surfaceContainerHighest",
].map(role => [role, "#123456"]));
const MOTION_FAST = { id: "effects.fast" };
const modules = new Map();
function mockFor(resolved) {
  const base = resolved.slice(sourceRoot.length);
  if (base === "/components/ui/Text.tsx") return { Text: "Text" };
  if (base === "/components/ui/MaterialIcon.tsx") return { MaterialIcon: Object.assign(() => null, { glyphMap: {} }) };
  if (base === "/theme/ThemeProvider.tsx") return { useTheme: () => ({ palette: PALETTE, expressive: themeState.expressive }) };
  if (base === "/theme/material-motion.ts") return {
    materialMotion: { effects: { fast: MOTION_FAST } },
    useMaterialMotion: () => ({ fast: MOTION_FAST, expressive: themeState.expressive, reducedMotion: themeState.reducedMotion }),
  };
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
      Platform: platformState, View: "View", Pressable: "Pressable",
      StyleSheet: {
        create: x => x,
        flatten: style => (Array.isArray(style) ? Object.assign({}, ...style.map(s => s && typeof s === "object" ? s : {})) : style ?? undefined),
        hairlineWidth: 1, absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      },
      Animated: animatedApi,
      useWindowDimensions: () => ({ width: 800, height: 600, fontScale: 1 }),
    };
    if (name === "react-native-reanimated") return reanimated;
    if (name === "react-native-gesture-handler") return { Pressable: "GesturePressable" };
    if (name.startsWith(".")) return load(resolveModule(dirname(filename), name));
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
  return mod.exports;
}
const ui = name => load(resolve(sourceRoot, "components/ui", name));
const pillMotion = () => load(resolve(sourceRoot, "lib/stretchable-pill-motion.ts"));

// ------------------------------------------------------------------ helpers
function findNodes(node, predicate, found = []) {
  if (Array.isArray(node)) { for (const child of node) findNodes(child, predicate, found); return found; }
  if (!node || typeof node !== "object" || !("type" in node)) return found;
  if (predicate(node)) found.push(node);
  findNodes(node.props?.children, predicate, found);
  return found;
}
const byTestID = (tree, id) => findNodes(tree, node => node.props?.testID === id);
function flatStyle(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.flat(Infinity).filter(entry => entry && typeof entry === "object" && !entry.__animatedStyle));
  return style && typeof style === "object" && !style.__animatedStyle ? style : {};
}
const styleEntries = (style) => (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean);

/** Rendered horizontal span of a pill part given its style entries. */
function partSpan(styleEntriesList, fallbackLeft) {
  const flat = Object.assign({}, ...styleEntriesList.filter(e => e && typeof e === "object" && !e.__animatedStyle));
  const transform = styleEntriesList.flatMap(e => e?.transform ?? []);
  const scaleNode = transform.find(t => "scaleX" in t)?.scaleX;
  const shiftNode = transform.find(t => "translateX" in t)?.translateX;
  const width = flat.width ?? 0;
  const left = flat.left ?? fallbackLeft;
  const scale = scaleNode ? evalNode(scaleNode) : 1;
  const shift = shiftNode ? evalNode(shiftNode) : 0;
  const center = left + width / 2;
  const renderedWidth = width * scale;
  return [center + shift - renderedWidth / 2, center + shift + renderedWidth / 2];
}

function mountPill(widthValue, canvasWidth) {
  const StretchablePill = ui("StretchablePill.tsx").StretchablePill;
  return counted(mount(StretchablePill), {
    width: widthValue, canvasWidth,
    shape: { rest: 24, pressed: 12 },
    accessibilityRole: "button",
    children: "Pill",
  });
}

// ------------------------------------------------------------------ tests
const HEIGHT = 48, CAP = 24;
const { PILL_BLEED } = pillMotion();

test("The bleed is small, positive and shared by the algebra and the view", () => {
  assert.ok(PILL_BLEED > 0 && PILL_BLEED <= 3, "the overlap covers compositor snapping without escaping the caps");
  const source = readFileSync(resolve(sourceRoot, "components/ui/StretchablePill.tsx"), "utf8");
  assert.match(source, /bleed=\{PILL_BLEED\}/, "the opaque surface paints with the bleed");
  assert.match(source, /bleed=\{0\}/, "translucent overlays keep exact abutment");
});

test("The surface middle's rendered span bleeds under both caps for every width", () => {
  for (const canvasWidth of [342, 720]) {
    for (const width of [HEIGHT, 52, 79.5, 137.33, 200, canvasWidth]) {
      const value = new MockValue(width);
      const result = mountPill(value, canvasWidth);
      const middles = byTestID(result.tree, "material-pill-middle");
      assert.equal(middles.length, 2, "surface and overlay each paint a middle");
      // The surface middle is the one wider than the exact-abutment variant.
      const spans = middles.map(m => partSpan(styleEntries(m.props.style), CAP));
      const surface = spans.find(([l, r]) => r - l > (width - HEIGHT) + PILL_BLEED) ?? spans[0];
      const [wantLeft, wantRight] = [canvasWidth - width + CAP - PILL_BLEED, canvasWidth - CAP + PILL_BLEED];
      assert.ok(Math.abs(surface[0] - wantLeft) < 1e-6 && Math.abs(surface[1] - wantRight) < 1e-6,
        `canvas ${canvasWidth} width ${width}: rendered [${surface}] want [${wantLeft}, ${wantRight}]`);
      // The joint never opens: the middle reaches past both cap boundaries.
      assert.ok(surface[0] <= canvasWidth - width + CAP + 1e-6, "middle reaches under the leading cap");
      assert.ok(surface[1] >= canvasWidth - CAP - 1e-6, "middle reaches under the trailing cap");
    }
  }
});

test("A fully compressed pill paints only the hidden bleed, not a floating sliver", () => {
  const result = mountPill(new MockValue(HEIGHT), 342);
  const middles = byTestID(result.tree, "material-pill-middle");
  const spans = middles.map(m => partSpan(styleEntries(m.props.style), CAP));
  // The narrower span (exact abutment) is exactly zero wide at P = 48.
  const overlay = spans.reduce((a, b) => (b[1] - b[0] < a[1] - a[0] ? b : a));
  assert.ok(Math.abs((overlay[1] - overlay[0])) < 1e-6, `overlay middle is invisible at P=48, got [${overlay}]`);
  const surface = spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  assert.ok(Math.abs((surface[1] - surface[0]) - PILL_BLEED * 2) < 1e-6, `surface paints exactly the bleed at P=48, got ${surface[1] - surface[0]}`);
  assert.ok(surface[0] >= 342 - HEIGHT - 1e-6 && surface[1] <= 342 + 1e-6, "the bleed stays inside the pill");
});

test("Translucent overlay parts abut exactly: no stacked alpha at the seams", () => {
  for (const canvasWidth of [342, 720]) {
    for (const width of [HEIGHT + 4, 79.5, 137.33, 200]) {
      const result = mountPill(new MockValue(width), canvasWidth);
      const stateCanvas = byTestID(result.tree, "material-pill-state-layer")[0];
      const middles = byTestID(stateCanvas.props.children, "material-pill-middle");
      assert.equal(middles.length, 1, "the overlay paints one middle");
      const flat = Object.assign({}, ...styleEntries(middles[0].props.style));
      assert.equal(flat.left, CAP, "overlay middle starts at the cap boundary");
      assert.equal(flat.width, canvasWidth - HEIGHT, "overlay middle keeps the exact width");
      const [l, r] = partSpan(styleEntries(middles[0].props.style), CAP);
      assert.ok(Math.abs(l - (canvasWidth - width + CAP)) < 1e-6 && Math.abs(r - (canvasWidth - CAP)) < 1e-6,
        `overlay span [${l}, ${r}] abuts both caps exactly`);
    }
  }
});

test("Caps paint after the middle in both paints", () => {
  const result = mountPill(new MockValue(120), 342);
  for (const canvas of [result.tree, byTestID(result.tree, "material-pill-state-layer")[0].props.children]) {
    const kids = (function collect(node, acc = []) {
      const children = node.props?.children;
      const list = Array.isArray(children) ? children : children && typeof children === "object" && "type" in children ? [children] : [];
      for (const c of list) {
        if (c && typeof c === "object" && "type" in c) { acc.push(c.props?.testID ?? ""); collect(c, acc); }
      }
      return acc;
    })(canvas, []);
    const middle = kids.indexOf("material-pill-middle");
    const leading = kids.indexOf("material-pill-leading-cap");
    const trailing = kids.indexOf("material-pill-trailing-cap");
    assert.ok(middle >= 0 && leading > middle && trailing > middle, `middle precedes caps, got ${kids.join(",")}`);
  }
});

test("The pill state layer fades in its fill color, never an element opacity", () => {
  platformState.OS = "web";
  updaters.length = 0; sharedValueRegistry.length = 0;
  const result = mountPill(new MockValue(120), 342);
  assert.equal(result.sharedValueReads, 0, "mount reads no shared value from JS");
  assert.equal(result.delta.sharedValues, 4, "progress, layer, background, corners — no extra state");
  // No part of the state layer carries an opacity style.
  const stateCanvas = byTestID(result.tree, "material-pill-state-layer")[0];
  assert.equal(flatStyle(stateCanvas.props.style).opacity, undefined, "the overlay canvas keeps opacity 1");
  const overlayKids = stateCanvas.props.children;
  for (const part of findNodes(overlayKids, n => typeof n.type === "string")) {
    const flat = flatStyle(part.props?.style);
    assert.equal(flat.opacity, undefined, `overlay part ${part.props?.testID} has no opacity`);
  }
  // The animated fill marker landed on every painted overlay part.
  const markers = findNodes(overlayKids, n => styleEntries(n.props?.style).some(e => e && e.__animatedStyle));
  assert.equal(markers.length, 3, "all three overlay parts carry the animated fill");
});

test("Hover drives the fill alpha through the shared layer value", () => {
  platformState.OS = "web";
  const StretchablePill = ui("StretchablePill.tsx").StretchablePill;
  const render = mount(StretchablePill);
  const props = { width: new MockValue(120), canvasWidth: 342, shape: { rest: 24, pressed: 12 }, accessibilityRole: "button", children: "Pill" };
  // Only the updaters captured by the most recent render carry fresh state.
  const latestUpdaters = () => {
    const before = updaters.length;
    render(props);
    return updaters.slice(before);
  };
  latestUpdaters(); // mount
  const pressable = findNodes(render(props), n => typeof n.props?.onHoverIn === "function")[0];
  pressable.props.onHoverIn({}); // hovered -> fraction 0.08
  const hoveredUpdaters = latestUpdaters();
  for (const holder of sharedValueRegistry) holder.value = 0.5;
  const outputs = hoveredUpdaters.map(u => u());
  const fill = outputs.find(o => o && typeof o.backgroundColor === "string" && o.backgroundColor.startsWith("rgba("));
  assert.ok(fill, `an animated fill exists, got ${JSON.stringify(outputs)}`);
  assert.match(fill.backgroundColor, /rgba\(18,\s*52,\s*86,\s*0\.04\)/, "layer 0.5 x ink 0.08 fades in the color");
  for (const holder of sharedValueRegistry) holder.value = 1;
  const settled = hoveredUpdaters.map(u => u()).find(o => o && typeof o.backgroundColor === "string" && o.backgroundColor.startsWith("rgba("));
  assert.match(settled.backgroundColor, /rgba\(18,\s*52,\s*86,\s*0\.08\)/, "settled hover paints the 8% ink");
  for (const holder of sharedValueRegistry) holder.value = 0;
  const resting = hoveredUpdaters.map(u => u()).find(o => o && typeof o.backgroundColor === "string" && o.backgroundColor.startsWith("rgba("));
  assert.match(resting.backgroundColor, /rgba\(18,\s*52,\s*86,\s*0\)/, "rest stays transparent");
  // Any opacity style must be static layout opacity, never the fade itself.
  for (const holder of sharedValueRegistry) holder.value = 0.25;
  const quarter = hoveredUpdaters.map(u => u()).filter(o => o && o.opacity !== undefined);
  for (const holder of sharedValueRegistry) holder.value = 0.75;
  const threeQuarters = hoveredUpdaters.map(u => u()).filter(o => o && o.opacity !== undefined);
  assert.deepEqual(threeQuarters, quarter, "no updater fades the tint through element opacity");
  assert.ok(quarter.every(o => o.opacity === 1), "the only opacity is the control's static layout opacity");
});

test("A non-hex tint keeps the legacy opacity fade", () => {
  platformState.OS = "web";
  const PressableScale = ui("PressableScale.tsx").PressableScale;
  const render = mount(PressableScale);
  updaters.length = 0; sharedValueRegistry.length = 0;
  render({ shape: { rest: 24, pressed: 12 }, stateLayerColor: "transparent", accessibilityRole: "button", children: "X" });
  for (const holder of sharedValueRegistry) holder.value = 0.5;
  const outputs = updaters.map(u => u());
  assert.ok(outputs.some(o => o && o.opacity === 0.5), `unknown formats fall back to opacity, got ${JSON.stringify(outputs)}`);
});

test("The shared pressable's fallback state layer also fades in color", () => {
  platformState.OS = "web";
  const PressableScale = ui("PressableScale.tsx").PressableScale;
  const render = mount(PressableScale);
  updaters.length = 0; sharedValueRegistry.length = 0;
  const tree = render({ shape: { rest: 24, pressed: 12 }, accessibilityRole: "button", style: { borderRadius: 24 }, children: "X" });
  const layer = byTestID(tree, "material-state-layer")[0];
  assert.ok(layer, "the fallback state layer exists");
  const flat = flatStyle(layer.props.style);
  assert.equal(flat.opacity, undefined, "no static element opacity");
  assert.equal(flat.backgroundColor, "transparent", "the resting paint carries no ink");
  assert.ok(styleEntries(layer.props.style).some(e => e && e.__animatedStyle), "the animated fill is applied to the layer view");
});

test("Mounting a pill allocates exactly the animated pressable's four shared values", () => {
  platformState.OS = "web";
  sharedValueRegistry.length = 0;
  const result = mountPill(new MockValue(120), 342);
  assert.deepEqual(result.delta, { sharedValues: 4, animatedStyles: 4, springs: 0 }, "the fade redesign adds no Reanimated state");
  assert.equal(result.sharedValueReads, 0, "no synchronous shared-value JS reads");
});
