/** Run: node --test apps/mobile/scripts/reader-progress-pane.test.cjs
 * Actual-source reader progress acceptance tests. The real ReaderPane and the
 * real reading-progress module run against a stubbed native host; ScrollView
 * layout/content/scroll events are driven explicitly so the test observes
 * exactly what the bar would paint.
 *
 * Covers the reported failure and its lifecycle edges:
 *  - a completed row opens at the top with a 0 bar and is not rewritten;
 *  - a partial row paints only after its restore scroll is acknowledged;
 *  - a viewport-sized placeholder never flashes 100% before the settle window;
 *  - late content growth re-targets the restore and resets a short bar;
 *  - viewport resize repaints immediately from measured dimensions;
 *  - switching articles resets size/position state from the previous article;
 *  - reaching the bottom persists completion once; empty content stays at 0.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("../../../node_modules/typescript");
const React = require("../../../node_modules/react");
const { createRoot } = require("../../../node_modules/react-dom/client");
const { JSDOM } = require("../../../node_modules/jsdom");

const sourceRoot = resolve(__dirname, "../src");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.requestAnimationFrame = (callback) => dom.window.requestAnimationFrame(callback);
globalThis.cancelAnimationFrame = (id) => dom.window.cancelAnimationFrame(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* -------------------------------- host stubs -------------------------------- */

const counts = {
  articleRenders: 0,
  headerRenders: 0,
  scrollProps: null,
  progress: null,
  progressRenders: 0,
  scrollTo: [],
};
const writes = [];

const flattenStyle = (style) => {
  if (style == null) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style;
};
function host(tag, styleAttr) {
  return React.forwardRef(function Host({ style, children, ...rest }, ref) {
    const props = { ref };
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("data-") || key.startsWith("aria-") || key === "id" || key === "role") props[key] = value;
    }
    props[styleAttr] = JSON.stringify(flattenStyle(style));
    return React.createElement(tag, props, children);
  });
}
const Text = (props) => React.createElement(host("span", "data-textstyle"), props);
const reactNative = {
  Platform: { OS: "web", select: (options) => options.web ?? options.default },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 2 },
  StyleSheet: { hairlineWidth: 0.5, create: (styles) => styles, flatten: flattenStyle, absoluteFill: {} },
  Text,
  View: host("div", "data-viewstyle"),
  Image: host("img", "data-viewstyle"),
  Pressable: host("div", "data-viewstyle"),
  ScrollView: host("div", "data-viewstyle"),
  ActivityIndicator: () => null,
  Share: { share: () => Promise.resolve() },
  Linking: { openURL: () => Promise.resolve() },
  Alert: { alert() {} },
  findNodeHandle: () => null,
  UIManager: { measureInWindow: (_handle, callback) => callback(0, 0, 0, 0) },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
};
const AnimatedView = host("div", "data-viewstyle");
const Animated = Object.assign(AnimatedView, {
  View: AnimatedView,
  Text: host("span", "data-textstyle"),
  ScrollView: host("div", "data-viewstyle"),
  createAnimatedComponent: (component) => component,
});
const reanimated = {
  __esModule: true,
  default: Animated,
  useSharedValue: (value) => React.useRef({ value }).current,
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: (handler) => handler,
  useComposedEventHandler: (handlers) => ({
    onScroll(event) {
      for (const handler of handlers) handler?.onScroll?.(event);
    },
  }),
  withSpring: (value) => value,
  withTiming: (value) => value,
  Easing: { quad: (value) => value, inOut: (fn) => fn, bezier: () => (value) => value, linear: (value) => value },
  runOnJS: (fn) => fn,
  cancelAnimation: () => {},
  ReduceMotion: { Never: "never" },
};

/* ------------------------------ fixture state ------------------------------- */

const readerPalette = {
  mode: "dark", background: "#reader-bg", surface: "#reader-surface", onSurface: "#reader-onSurface",
  text: "#reader-text", textSecondary: "#reader-textSecondary", textTertiary: "#reader-textTertiary",
  accent: "#reader-accent", primary: "#reader-primary", border: "#reader-border",
  outlineVariant: "#reader-outline", danger: "#reader-danger",
};
const appPalette = { ...readerPalette, mode: "light" };
const authUser = {
  id: "u1",
  preferences: { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "dark", amoled: false },
};
const settings = {
  serverUrl: "https://fixture.test", websiteBrowser: "ordo", forceWebsiteDark: false,
  materialYouColors: false, expressive: true, themeContrast: 0,
};
const preferences = authUser.preferences;
const EMPTY_FOLDERS = [];
const SERVER_INFO = { reminders: true };
const EMPTY_HIGHLIGHTS = [];

const stamp = "2026-10-20T12:00:00Z";
const baseDetail = {
  id: "b1", folderId: null, title: "Progress audit article", url: "https://example.test/article",
  domain: "example.test", description: "A saved article.", fetchStatus: "ok", contentKind: "article",
  contentKindOverride: null, extractionVersion: 1, author: null, publishedAt: null, readingTimeMinutes: 4,
  readProgress: 0, isRead: false, remindAt: null, tags: [], suggestedTags: [],
  createdAt: stamp, updatedAt: stamp,
  contentHtml: Array.from({ length: 100 }, (_, index) => `<h2>Section ${index + 1}</h2><p>Body ${index + 1}.</p>`).join(""),
  highlights: [],
};
const details = new Map();
const detailListeners = new Set();
const detailStore = {
  subscribe(notify) { detailListeners.add(notify); return () => detailListeners.delete(notify); },
  get(id) { return details.get(id); },
  set(id, value) { details.set(id, value); detailListeners.forEach((notify) => notify()); },
  update(id, updater) {
    const current = details.get(id);
    if (!current) return;
    details.set(id, updater(current));
    detailListeners.forEach((notify) => notify());
  },
};
function reset(overrides = {}) {
  details.clear();
  details.set("b1", { ...baseDetail, ...overrides });
  writes.length = 0;
  counts.articleRenders = 0;
  counts.headerRenders = 0;
  counts.scrollProps = null;
  counts.progress = null;
  counts.progressRenders = 0;
  counts.scrollTo = [];
}

const ArticleStub = React.memo(function ArticleStub(props) {
  counts.articleRenders += 1;
  // Match ArticleSections: readiness arrives after the frame that mounted the
  // tree, so ReaderPane's per-article reset effect has already run.
  React.useEffect(() => {
    const timer = setTimeout(() => props.onReady?.(), 0);
    return () => clearTimeout(timer);
  }, [props.onReady]);
  return React.createElement("div", { "data-article": String(props.html.length) });
});
const LinearProgressStub = ({ value, animatedValue, label }) => {
  counts.progressRenders += 1;
  counts.progress = { value, animatedValue, label };
  return React.createElement("div", {
    "data-progress": label,
    "data-value": String(value),
    "data-animated": animatedValue ? String(animatedValue.value) : undefined,
  });
};
const ThemedScrollView = React.forwardRef(function ThemedScrollView(props, ref) {
  counts.scrollProps = props;
  React.useImperativeHandle(ref, () => ({
    scrollTo(options) { counts.scrollTo.push(options); },
    getInnerViewNode: () => null,
  }), []);
  return React.createElement("div", null, props.children);
});
const ReaderContents = React.forwardRef(function ReaderContents(_props, ref) {
  React.useImperativeHandle(ref, () => ({ prepare() {}, open() {} }), []);
  return null;
});
const ReaderActions = React.forwardRef(function ReaderActions(_props, ref) {
  React.useImperativeHandle(ref, () => ({ close() {} }), []);
  return React.createElement("div", { "data-actions": "1" });
});
const ReaderControlsSheet = React.forwardRef(function ReaderControlsSheet(_props, ref) {
  React.useImperativeHandle(ref, () => ({ open() {} }), []);
  return null;
});
const Header = ({ title, right }) => {
  counts.headerRenders += 1;
  return React.createElement("header", null, title, right);
};
const noop = () => {};
const stable = (value) => value;

const stubs = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": reactNative,
  "react-native-reanimated": reanimated,
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  "expo-status-bar": { StatusBar: () => null, setStatusBarStyle: noop },
  "../../theme/use-system-color-scheme": { useSystemColorScheme: () => "dark" },
  "../../hooks/use-scene-column-insets": { useSceneColumnInsets: () => ({ sceneWidth: 390 }) },
  "../ui/MaterialIcon": { MaterialIcon: (props) => React.createElement("i", null, props.name) },
  "../../hooks/use-app-router": { useAppRouter: () => ({ canGoBack: () => false, back: noop, replace: noop }) },
  "../ui/Header": { Header, HeaderActions: ({ children }) => React.createElement("div", null, children), HeaderIconButton: () => null },
  "../ui/ScreenContent": { ScreenContent: ({ children }) => React.createElement("div", null, children) },
  "../ui/Text": { Text },
  "../ui/Button": { Button: ({ label, onPress }) => React.createElement("button", { onClick: onPress }, label) },
  "../ui/EmptyState": { EmptyState: () => null },
  "../ui/Skeleton": { Skeleton: () => null, SkeletonGroup: ({ children }) => React.createElement("div", null, children) },
  "../ui/ThemedScrollView": { ThemedScrollView },
  "../ui/ContextMenu": { ContextMenu: () => null, ContextMenuItem: () => null },
  "../ui/LinearProgress": { LinearProgress: LinearProgressStub },
  "./ReaderArticle": { ReaderArticle: ArticleStub },
  "./ReaderContents": { ReaderContents },
  "./ReaderActions": { ReaderActions },
  "./ReaderControlsSheet": { ReaderControlsSheet },
  "../bookmarks/LockPrompt": { LockPrompt: () => null },
  "./reader-typography": {
    READER_BODY_SIZE: { small: 15, medium: 17, large: 19, xlarge: 21 },
    resolveReaderFont: (family, weight = "400") => `${family}-${weight}`,
  },
  "../../theme/fonts": {
    useReaderFontFamily: (family) => family,
    useReaderFontRevision: () => 0,
  },
  "../../theme/ThemeProvider": {
    useTheme: () => ({ palette: appPalette, expressive: true }),
    ThemeOverrideProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  },
  "../../theme/reader-theme": { resolveReaderPalette: () => readerPalette },
  "../../theme/pin-system-chrome": { pinSystemChrome: () => Promise.resolve() },
  "../../theme/current-app-palette": { currentAppPalette: () => appPalette },
  "../../theme/device-colors": { useDeviceColors: () => null },
  "../../lib/query-client": { queryClient: {} },
  "../../lib/api/bookmarks": { bookmarksApi: { update: () => Promise.resolve(null) } },
  "../../lib/cache-helpers": {
    findBookmarkInCache: () => undefined,
    updateBookmarkEverywhere: (_queryClient, id, updater) => { detailStore.update(id, updater); },
  },
  "../../hooks/use-bookmarks": {
    useBookmarkDetail: (id) => ({
      data: React.useSyncExternalStore(detailStore.subscribe, () => detailStore.get(id), () => detailStore.get(id)),
      isLoading: false,
      error: null,
      refetch: noop,
    }),
    useCreateHighlight: () => ({ isPending: false, mutate: noop, mutateAsync: () => Promise.resolve() }),
    useUpdateHighlight: () => ({ isPending: false, mutate: noop, mutateAsync: () => Promise.resolve() }),
    useRemoveHighlight: () => ({ isPending: false, mutate: noop, mutateAsync: () => Promise.resolve() }),
    useSetContentKind: () => ({ mutate: noop, isPending: false }),
  },
  "../../hooks/queries": {
    useFolders: () => ({ data: EMPTY_FOLDERS }),
    useServerInfo: () => ({ data: SERVER_INFO }),
  },
  "../../hooks/use-reader-preferences": {
    useReaderPreferences: () => ({ preferences, setPreferences: noop }),
  },
  "../../hooks/use-reader-chrome": {
    useReaderChrome: () => stable({
      expansion: stable({ spatial: {}, effects: {} }),
      hidden: stable({ value: 0 }),
      expand: noop,
      scrollHandler: {},
    }),
  },
  "../../store/settings": (() => {
    const hook = (selector) => selector ? selector(settings) : settings;
    hook.getState = () => settings;
    return { useSettingsStore: hook };
  })(),
  "../../store/auth": (() => {
    const state = () => ({ user: authUser });
    const hook = (selector) => selector ? selector(state()) : state();
    hook.getState = state;
    return { useAuthStore: hook };
  })(),
  "../../lib/format": { domainFromUrl: () => "example.test", formatDate: () => "Oct 20" },
  "../../lib/error-message": { errorMessage: () => "error", folderProtectedId: () => null, isFolderProtected: () => false },
  "../../lib/haptics": { haptics: { light: noop, selection: noop } },
  "../../theme/tokens": {
    layout: { maxReaderWidth: 720 },
    spacing: new Proxy({}, { get: (_target, key) => (key === "px" ? 1 : Number(key) || 0) }),
  },
  "../ui/toast-store": { toast: { error: noop, success: noop } },
  "../../lib/menu-anchor": { isMenuAnchorRect: () => true },
  "../browser/BookmarkBrowser": {
    BookmarkBrowser: React.forwardRef(function BookmarkBrowser(_props, ref) {
      React.useImperativeHandle(ref, () => ({ goBack: () => false, reload: noop }), []);
      return null;
    }),
  },
  "../../lib/bookmark-reader": { bookmarkOpensAsWebsite: () => false, canReadInOrdo: () => true },
  "../../lib/copy-link": { copyLink: () => Promise.resolve(), copyText: () => Promise.resolve() },
  "../../lib/open-website": { ackBookmarkOpened: noop, openExternalBrowser: noop, openLivePage: noop },
  "../../lib/bookmark-reminders": { reminderClearsOnOpen: () => false },
  "../../lib/fab-layout": { fabContentPadding: () => 0 },
  "../../hooks/use-reduced-motion-preference": { useReducedMotionPreference: () => false },
  "../../lib/latest-write-queue": {
    createLatestWriteQueue: () => (_key, write) => { writes.push(write); },
  },
  "../../lib/session-scope": {
    captureSessionScope: () => ({ generation: 1 }),
    isSessionScopeCurrent: () => true,
  },
  "../../lib/idle-work": {
    scheduleIdleWork: (work) => {
      const timer = setTimeout(work, 0);
      return () => clearTimeout(timer);
    },
  },
};

/* --------------------------- transpiled source loader ------------------------- */

const modules = new Map();
function resolveLocal(from, name) {
  for (const candidate of [name, `${name}.tsx`, `${name}.ts`, `${name}/index.ts`]) {
    const path = resolve(from, candidate);
    try { readFileSync(path); return path; } catch {}
  }
  throw new Error(`Cannot resolve ${name} from ${from}`);
}
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const localRequire = (name) => {
    if (stubs[name]) return stubs[name];
    if (name.startsWith(".")) return load(resolveLocal(dirname(filename), name));
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

const ReaderPane = load(resolve(sourceRoot, "components/reader/ReaderPane.tsx")).ReaderPane;
const READING_SETTLE_MS = 400;
const delay = (ms) => new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
async function settle(ms = 20) {
  await React.act(async () => { await delay(ms); });
}
const bar = () => counts.progress?.animatedValue?.value ?? 0;
const barPercent = () => counts.progress ? Math.round(counts.progress.value * 100) : null;

async function mount(bookmarkId = "b1") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(ReaderPane, { bookmarkId, embedded: true }));
  });
  await settle(40);
  return {
    root,
    counts,
    async rerender(nextId) {
      await React.act(async () => {
        root.render(React.createElement(ReaderPane, { bookmarkId: nextId, embedded: true }));
      });
      await settle(40);
    },
    async unmount() {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

async function layout(height) {
  assert.ok(counts.scrollProps, "the scroll surface is mounted");
  await React.act(async () => {
    counts.scrollProps.onLayout({ nativeEvent: { layout: { height } } });
  });
  await settle(5);
}
async function content(height) {
  assert.ok(counts.scrollProps, "the scroll surface is mounted");
  await React.act(async () => {
    counts.scrollProps.onContentSizeChange(360, height);
  });
  await settle(5);
}
async function scroll(y, { contentHeight = 10000, viewportHeight = 800 } = {}) {
  assert.ok(counts.scrollProps, "the scroll surface is mounted");
  const event = {
    nativeEvent: {
      contentOffset: { y },
      contentSize: { height: contentHeight },
      layoutMeasurement: { height: viewportHeight },
    },
  };
  await React.act(async () => {
    counts.scrollProps.onScroll(event);
    counts.scrollProps.animatedScrollHandler?.onScroll?.(event.nativeEvent);
  });
  await settle(5);
}

/* ---------------------------------- tests ----------------------------------- */

test("a completed row opens at the top with a zero bar and is not rewritten", async (t) => {
  reset({ readProgress: 1, isRead: true });
  const view = await mount();
  t.after(() => view.unmount());

  assert.equal(bar(), 0, "the saved completion is not displayed at the top");
  await layout(800);
  await content(10000);
  assert.equal(counts.scrollTo.length, 0, "completed rows intentionally do not restore scroll");
  assert.equal(bar(), 0, "a measured top viewport stays at 0%");
  assert.equal(barPercent(), 0);

  await scroll(-24);
  assert.equal(bar(), 0, "top overscroll cannot paint a fraction");
  assert.equal(writes.length, 0, "opening/fiddling at the top cannot erase completion");
  await settle(READING_SETTLE_MS + 80);
  assert.equal(writes.length, 0, "the settle pass does not write either");
});

test("a partial row paints only after its restore scroll is acknowledged", async (t) => {
  reset({ readProgress: 0.4 });
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(10000);
  assert.equal(counts.scrollTo.length, 1, "a partial row restores once");
  assert.equal(counts.scrollTo[0].y, 0.4 * (10000 - 800), "restore targets the saved fraction");
  assert.equal(counts.scrollTo[0].animated, false);
  assert.equal(bar(), 0, "the saved fraction is not painted before the scroll is real");

  await scroll(counts.scrollTo[0].y);
  assert.ok(Math.abs(bar() - 0.4) < 1e-9, "the acknowledged restore paints the saved fraction");
  assert.equal(barPercent(), 40);
  assert.equal(writes.length, 0, "a programmatic restore is not a new progress edit");

  // The first user movement away from the restored position is persisted.
  await scroll(5000);
  assert.ok(writes.length >= 1, "a real scroll writes the new position");
  assert.ok(writes.at(-1).progress > 0.4, "the write follows the viewport");

  // Once the restored position was real, scrolling back to the top is a real
  // top position and must persist 0 (unlike a fresh completed row's top guard).
  await scroll(0);
  assert.equal(bar(), 0);
  assert.equal(writes.at(-1).progress, 0, "a restored partial row can be moved back to the top");
});

test("late content growth keeps the restored fraction and re-targets the scroll", async (t) => {
  reset({ readProgress: 0.4 });
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(10000);
  const first = counts.scrollTo[0].y;
  await scroll(first);
  assert.ok(Math.abs(bar() - 0.4) < 1e-9);

  // A late image/font pass makes the article taller.
  await content(14000);
  assert.equal(counts.scrollTo.length, 2, "the restore is re-issued for the new range");
  assert.equal(counts.scrollTo[1].y, 0.4 * (14000 - 800));
  assert.ok(Math.abs(bar() - 0.4) < 1e-9, "the bar does not fall back to the stale offset");

  await scroll(counts.scrollTo[1].y, { contentHeight: 14000 });
  assert.ok(Math.abs(bar() - 0.4) < 1e-9, "the acknowledged growth restore stays at the saved fraction");
  assert.equal(writes.length, 0, "layout growth alone does not write progress");
});

test("a viewport-sized placeholder never flashes full before the settle window", async (t) => {
  reset();
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(700);
  assert.equal(bar(), 0, "unsettled short content must not paint 100%");
  await scroll(-20, { contentHeight: 700 });
  assert.equal(bar(), 0, "a bounce cannot arm the short completion early");
  assert.equal(writes.length, 0);

  await settle(READING_SETTLE_MS + 80);
  assert.equal(bar(), 1, "genuinely short content completes after it stops changing");
  assert.equal(writes.length, 0, "short content never writes a scroll position");

  // An image loads after the settle window: the article becomes scrollable.
  await content(10000);
  assert.equal(bar(), 0, "growth immediately returns the bar to the top");
  await settle(READING_SETTLE_MS + 80);
  assert.equal(bar(), 0, "the new range is still at the top");
  assert.equal(writes.length, 0, "neither the false short state nor its repair writes progress");
});

test("viewport resize repaints from the measured dimensions and scroll does not rerender the article", async (t) => {
  reset();
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(10000);
  const beforeScroll = view.counts.articleRenders;
  await scroll(300);
  const portrait = bar();
  assert.ok(Math.abs(portrait - 300 / 9200) < 1e-9);
  assert.equal(view.counts.articleRenders, beforeScroll, "a scroll never re-renders the article wrapper");

  await layout(2000);
  const landscape = bar();
  assert.ok(Math.abs(landscape - 300 / 8000) < 1e-9, "the bar uses the new viewport immediately");
  assert.ok(landscape > portrait, "a taller viewport advances the fraction for the same offset");
  assert.equal(writes.length, 0, "the small scroll is still inside the write delta");

  // A resize/reflow that leaves the content shorter than the viewport is a
  // fresh short measurement: it must start at 0, never inherit full from a
  // pre-resize placeholder.
  await content(1200);
  assert.equal(bar(), 0, "a resize into unsized short content cannot flash 100%");
  await settle(READING_SETTLE_MS + 80);
  assert.equal(bar(), 1, "after the new height settles, the fully visible content completes");
  assert.equal(writes.length, 0, "short content still does not write progress");
});

test("switching articles clears the previous article's dimensions and fraction", async (t) => {
  reset({ readProgress: 0.5 });
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(10000);
  await scroll(counts.scrollTo[0].y);
  assert.ok(Math.abs(bar() - 0.5) < 1e-9);
  const scrollsBefore = counts.scrollTo.length;

  detailStore.set("b2", { ...baseDetail, id: "b2", readProgress: 0, contentHtml: "<p>Second article.</p>" });
  await view.rerender("b2");
  assert.equal(bar(), 0, "the new article starts at the top, not the old fraction");
  assert.equal(counts.scrollTo.length, scrollsBefore, "stale dimensions do not issue a stale restore");

  await layout(800);
  await content(3000);
  assert.equal(bar(), 0);
  assert.equal(writes.length, 0);
});

test("a completed row that grows from short keeps completion through a top bounce", async (t) => {
  reset({ readProgress: 1, isRead: true });
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(700);
  await settle(READING_SETTLE_MS + 80);
  assert.equal(bar(), 1, "the completed row is fully visible at first");
  await content(10000);
  assert.equal(bar(), 0, "growth returns the bar to the real top viewport");
  await scroll(-30);
  assert.equal(writes.length, 0, "a bounce on a grown completed row does not erase completion");
  assert.equal(details.get("b1").readProgress, 1);
  assert.equal(details.get("b1").isRead, true);
});

test("reaching the bottom persists completion once", async (t) => {
  reset();
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(10000);
  await scroll(9200);
  assert.equal(bar(), 1, "the bottom paints a full bar");
  assert.equal(writes.length, 1, "the completion crossing writes once");
  assert.equal(writes[0].progress, 1);
  assert.equal(details.get("b1").readProgress, 1, "the optimistic row is completed");
  assert.equal(details.get("b1").isRead, true);
});

test("empty article content stays at zero without writes", async (t) => {
  reset();
  const view = await mount();
  t.after(() => view.unmount());

  await layout(800);
  await content(0);
  assert.equal(bar(), 0);
  await settle(READING_SETTLE_MS + 80);
  assert.equal(bar(), 0);
  assert.equal(writes.length, 0);
});
