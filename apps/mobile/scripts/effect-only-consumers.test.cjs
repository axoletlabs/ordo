/** Run with: node --test apps/mobile/scripts/effect-only-consumers.test.cjs
 *
 * Actual-source check that an effect-only consumer (LinearProgress) does not
 * render on activity pause/resume and that its paused callback cancels the
 * repeating phase work.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const counts = { view: 0, cancels: 0, fab: 0, scheduleCancels: 0, article: 0, scheduled: 0 };
const sharedValues = [];
const RendererStub = () => { counts.article += 1; return null; };
const View = ({ testID, accessibilityRole, accessibilityLabel, accessibilityValue, onLayout, maxWidth, children, ...rest }) => {
  counts.view += 1;
  void testID; void accessibilityRole; void accessibilityLabel; void accessibilityValue; void onLayout; void maxWidth;
  return React.createElement("div", rest, children);
};
const Animated = { View, createAnimatedComponent: component => component };
const reanimated = {
  __esModule: true,
  default: Animated,
  useSharedValue(initial) {
    const value = { value: initial };
    sharedValues.push(value);
    return value;
  },
  useAnimatedStyle: () => ({}),
  useAnimatedProps: () => ({}),
  withRepeat: () => "repeat",
  withTiming: value => value,
  cancelAnimation: () => { counts.cancels += 1; },
  Easing: { linear: value => value, bezier: () => value => value },
  ReduceMotion: { Never: "never" },
};
const FlatList = React.forwardRef(function FlatList({ data, renderItem }, ref) {
  React.useImperativeHandle(ref, () => ({ scrollToOffset() {} }), []);
  return React.createElement("div", null, data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item, index }))));
});
const palette = { secondaryContainer: "#222", primary: "#fff", surfaceContainerLow: "#111" };
const stubs = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": {
    Platform: { OS: "web" },
    View,
    FlatList,
    StyleSheet: { create: value => value },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  },
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
  "react-native-reanimated": reanimated,
  "react-native-svg": { default: ({ children }) => React.createElement("svg", null, children), Path: () => null },
  "../ui/FAB": {
    FAB: () => { counts.fab += 1; return null; },
    FABLayer: View,
  },
  "../ui/FloatingPanel": { FloatingPanel: ({ visible, keepMounted, children }) => visible || keepMounted ? React.createElement("div", null, children) : null },
  "../ui/PanelHeader": { PanelHeader: () => null },
  "../ui/ListPressable": { ListPressable: ({ children }) => React.createElement("button", null, children) },
  "../ui/Text": { Text: ({ children }) => React.createElement("span", null, children) },
  "../ui/ThemedScrollView": { ThemedScrollView: View },
  "../ui/Skeleton": { Skeleton: () => null, SkeletonGroup: ({ children }) => children },
  "../../hooks/use-scene-ready": { useSceneReady: () => true },
  "../../lib/idle-work": {
    scheduleIdleWork(callback) {
      counts.scheduled += 1;
      const timer = setTimeout(callback, 0);
      return () => clearTimeout(timer);
    },
  },
  "../../theme/ThemeProvider": { useTheme: () => ({ palette, expressive: false }) },
  "../../theme/list-shape": { listCorners: () => ({}), listPosition: () => "middle" },
  "../../theme/tokens": {
    layout: { maxReaderWidth: 720 },
    radius: { xs: 4 },
    spacing: new Proxy({}, { get: () => 8 }),
  },
  "../../theme/material-motion": { useMaterialMotion: () => ({ reducedMotion: false }) },
  "../../lib/progress-fraction": { progressFraction: value => value },
  "../../lib/material-progress": {
    linearIndeterminateSegments: () => [{ start: 0.2, end: 0.8 }],
    wavyProgressPath: () => "",
  },
};

const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  new Function("require", "module", "exports", outputText)(id => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "react-native") return stubs["react-native"];
    if (id === "react-native-reanimated") return reanimated;
    if (id === "react-native-svg") return stubs["react-native-svg"];
    if (id === "../../hooks/use-animation-activity") return activity;
    if (id === "./ArticleHtml") return { ArticleHtml: RendererStub };
    if (stubs[id]) return stubs[id];
    throw new Error(`Unexpected import: ${id}`);
  }, module, module.exports);
  return module.exports;
}
const activity = load(resolve(sourceRoot, "hooks/use-animation-activity.ts"));
const { LinearProgress } = load(resolve(sourceRoot, "components/ui/LinearProgress.tsx"));
const { ReaderContents } = load(resolve(sourceRoot, "components/reader/ReaderContents.tsx"));
const { ReaderArticle } = load(resolve(sourceRoot, "components/reader/ReaderArticle.tsx"));

test("LinearProgress pauses and resets without rendering", async () => {
  const scope = activity.createAnimationActivityScope();
  const tree = (props) => React.createElement(activity.AnimationActivityContext.Provider, { value: true },
    React.createElement(activity.AnimationActivityScopeContext.Provider, { value: scope },
      React.createElement(LinearProgress, props)));
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(tree({ value: 0.5, label: "Progress" })));
    const initial = counts.view;
    await React.act(() => scope.setActive(false));
    assert.equal(counts.view, initial, "pause must not render LinearProgress");
    await React.act(() => scope.setActive(true));
    assert.equal(counts.view, initial, "resume must not render LinearProgress");

    await React.act(() => root.render(tree({ label: "Indeterminate" })));
    assert.ok(sharedValues.some(value => value.value === "repeat"), "indeterminate phase starts while active");
    const beforePause = counts.view;
    await React.act(() => scope.setActive(false));
    assert.equal(counts.view, beforePause, "pause during indeterminate work must not render");
    assert.ok(!sharedValues.some(value => value.value === "repeat"), "pause resets the repeating phase");
    assert.ok(counts.cancels > 0, "pause cancels the repeating animation");
  } finally {
    await React.act(() => root.unmount());
  }
});

test("ReaderArticle pause does not render the loaded article", async () => {
  const scope = activity.createAnimationActivityScope();
  const tree = React.createElement(activity.AnimationActivityContext.Provider, { value: true },
    React.createElement(activity.AnimationActivityScopeContext.Provider, { value: scope },
      React.createElement(ReaderArticle, { html: "<p>Article</p>" })));
  const root = createRoot(dom.window.document.createElement("div"));
  try {
    await React.act(() => root.render(tree));
    await new Promise(resolve => setTimeout(resolve, 20));
    await React.act(async () => { await Promise.resolve(); });
    assert.ok(counts.scheduled > 0, "the active reader schedules the idle article load");
    assert.ok(counts.article > 0, "the idle article load renders the renderer");
    const rendered = counts.article;
    await React.act(() => scope.setActive(false));
    assert.equal(counts.article, rendered, "pause must not render the article wrapper");
    await React.act(() => scope.setActive(true));
    assert.equal(counts.article, rendered, "resume must not render the article wrapper");
  } finally {
    await React.act(() => root.unmount());
  }
});

test("ReaderContents pause cancels preparation without rendering", async () => {
  const scope = activity.createAnimationActivityScope();
  let scheduled = 0;
  let cancelled = 0;
  const workScheduler = {
    schedule() {
      scheduled += 1;
      return () => { cancelled += 1; };
    },
  };
  const ref = React.createRef();
  const tree = React.createElement(activity.AnimationActivityContext.Provider, { value: true },
    React.createElement(activity.AnimationActivityScopeContext.Provider, { value: scope },
      React.createElement(ReaderContents, {
        ref,
        headings: [{ id: "one", text: "One", level: 2 }, { id: "two", text: "Two", level: 2 }],
        onSelect() {}, expansion: {}, embedded: false, bottom: 0, sceneWidth: 390, workScheduler,
      })));
  const root = createRoot(dom.window.document.createElement("div"));
  try {
    await React.act(() => root.render(tree));
    await React.act(() => ref.current.prepare());
    assert.equal(scheduled, 1, "active contents preparation schedules idle work");
    const fabBeforePause = counts.fab;

    await React.act(() => scope.setActive(false));
    assert.equal(cancelled, 1, "pause cancels the scheduled preparation");
    assert.equal(counts.fab, fabBeforePause, "pause must not render ReaderContents");

    await React.act(() => scope.setActive(true));
    assert.equal(scheduled, 2, "resume schedules preparation again");
    assert.equal(counts.fab, fabBeforePause, "resume must not render ReaderContents");
  } finally {
    await React.act(() => root.unmount());
    assert.equal(cancelled, 2, "unmount cancels the active preparation");
  }
});
