/** Run: node --test apps/mobile/scripts/reader-pane-work.test.cjs
 * Actual-source work counts for the reader surface: the real ReaderPane,
 * ReaderArticle and ReaderControlsSheet run against a stubbed host, real
 * React and the real @ordo/shared selection helpers.
 *
 * Guards the reader's update boundaries:
 *  - a progress cache write re-renders reader chrome but not the article
 *    wrapper or the retained controls panel;
 *  - opening settings does not re-render the reader surface at all (the panel
 *    owns its open state);
 *  - a preference press renders the pane once (deferred article pass), not
 *    once eagerly and again when the deferred value lands;
 *  - a theme-only change restyles chrome but hands the article no new props
 *    (the article reads ink from the palette context);
 *  - preview-font arrivals leave visible controls unchanged and update only
 *    the dormant typeface control after dismissal;
 *  - scrolling with the selection menu open moves its anchor without
 *    re-scanning the article for highlight overlap;
 *  - a real content/highlight change still reaches the article.
 *
 * Set ORDO_CONTROL_SOURCE_ROOT to a source snapshot to compare older reader
 * sources; the assertions describe the current boundaries.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.requestAnimationFrame = (callback) => dom.window.requestAnimationFrame(callback);
globalThis.cancelAnimationFrame = (id) => dom.window.cancelAnimationFrame(id);
globalThis.requestIdleCallback = undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* -------------------------------- host stubs -------------------------------- */

const counts = {
  articleRenders: 0,
  articleHookCalls: 0,
  previewBatches: 0,
  previewPreloads: 0,
  headerRenders: 0,
  textRenders: 0,
  selectionChecks: 0,
  segmented: {},
  segmentedOptions: {},
  actionItemRenders: 0,
  menuContent: null,
  copiedLink: null,
  tagEditorRenders: 0,
  sheetVisible: 0,
  scrollProps: null,
  articleProps: null,
  settingsButton: null,
  panelDismiss: null,
  panelEntered: null,
  menuAnchor: null,
};

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
const Text = (props) => {
  counts.textRenders += 1;
  return React.createElement(host("span", "data-textstyle"), props);
};
const reactNative = {
  Platform: { OS: "web", select: (options) => options.web ?? options.default },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 2 },
  StyleSheet: { hairlineWidth: 0.5, create: (styles) => styles, flatten: flattenStyle, absoluteFill: {} },
  Text,
  View: host("div", "data-viewstyle"),
  Image: host("img", "data-viewstyle"),
  Pressable: host("div", "data-viewstyle"),
  ActivityIndicator: () => null,
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
  createAnimatedComponent: (component) => component,
});
const reanimated = {
  __esModule: true,
  default: Animated,
  useSharedValue: (value) => React.useRef({ value }).current,
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: (handler) => handler,
  useComposedEventHandler: (handlers) => handlers,
  withSpring: (value) => value,
  withTiming: (value) => value,
  Easing: { quad: (value) => value, inOut: (fn) => fn },
  runOnJS: (fn) => fn,
  cancelAnimation: () => {},
};

/* ------------------------------ fixture state ------------------------------- */

const readerPalette = {
  mode: "dark", background: "#reader-bg", surface: "#reader-surface", onSurface: "#reader-onSurface",
  text: "#reader-text", textSecondary: "#reader-textSecondary", textTertiary: "#reader-textTertiary",
  accent: "#reader-accent", primary: "#reader-primary", border: "#reader-border",
  outlineVariant: "#reader-outline", danger: "#reader-danger",
};
const readerPalettes = {
  dark: readerPalette,
  light: { ...readerPalette, mode: "light", background: "#reader-bg-light" },
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
const preferenceListeners = new Set();
let preferences = authUser.preferences;
const preferencesStore = {
  subscribe(notify) { preferenceListeners.add(notify); return () => preferenceListeners.delete(notify); },
  get() { return preferences; },
  set(patch) {
    preferences = { ...preferences, ...patch };
    authUser.preferences = preferences;
    preferenceListeners.forEach((notify) => notify());
  },
};
const detailListeners = new Set();
const baseDetail = {
  id: "b1", folderId: null, title: "Performance audit article", url: "https://example.test/article",
  domain: "example.test", description: "A saved article.", fetchStatus: "ok", contentKind: "article",
  contentKindOverride: null, extractionVersion: 1, author: null, publishedAt: null, readingTimeMinutes: 4,
  readProgress: 0, isRead: false, remindAt: null, tags: [], suggestedTags: [],
  createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z",
  contentHtml: Array.from({ length: 100 }, (_, index) => `<h2>Section ${index + 1}</h2><p>Body ${index + 1}.</p>`).join(""),
  highlights: [],
};
let detailData = baseDetail;
const detailStore = {
  subscribe(notify) { detailListeners.add(notify); return () => detailListeners.delete(notify); },
  get() { return detailData; },
  set(next) { detailData = next; detailListeners.forEach((notify) => notify()); },
};
const fontListeners = new Set();
const previewReady = new Set();
let fontRevision = 0;
const fonts = {
  READER_FONT_FAMILY_LIST: ["serif", "sans", "garamond", "bitter", "jost"],
  readerFontPreviewReady: (family) => previewReady.has(family),
  resolveReaderFontPreview: (family) => previewReady.has(family) ? `${family}-400` : undefined,
  readerFontsReady: () => true,
  loadReaderFonts: () => Promise.resolve(),
  loadReaderFontPreview: () => Promise.resolve(),
  loadReaderFontPreviews: () => { counts.previewBatches += 1; return Promise.resolve(); },
  preloadReaderFontPreviews: () => { counts.previewPreloads += 1; return Promise.resolve(); },
  useReaderFontFamily: (family) => family,
  useReaderFontRevision: () => React.useSyncExternalStore(
    (notify) => { fontListeners.add(notify); return () => fontListeners.delete(notify); },
    () => fontRevision,
    () => fontRevision,
  ),
  arrivePreview(family) {
    previewReady.add(family);
    fontRevision += 1;
    fontListeners.forEach((notify) => notify());
  },
};

const ArticleHtmlStub = React.memo(function ArticleHtmlStub(props) {
  counts.articleRenders += 1;
  counts.articleProps = props;
  return React.createElement("div", { "data-article": "1" });
});
const Segmented = ({ accessibilityLabel, options, value, onChange }) => {
  counts.segmented[accessibilityLabel] = (counts.segmented[accessibilityLabel] ?? 0) + 1;
  counts.segmentedOptions[accessibilityLabel] = options;
  return React.createElement("div", { "data-segmented": accessibilityLabel },
    options.map((option) => React.createElement("button", {
      key: option.value,
      "data-label": option.label,
      "aria-checked": value === option.value ? "true" : "false",
      onClick: () => onChange(option.value),
    }, option.label)));
};
const Toggle = () => React.createElement("div", { "data-toggle": "1" });
const PanelPresenceContext = React.createContext(null);
const FloatingPanel = ({ visible, keepMounted, onDismiss, onEntered, onExited, children }) => {
  const previous = React.useRef(false);
  React.useLayoutEffect(() => {
    if (visible && !previous.current) {
      counts.sheetVisible += 1;
      counts.panelDismiss = onDismiss;
      counts.panelEntered = onEntered;
    }
    if (previous.current && !visible) onExited?.();
    previous.current = visible;
  }, [onDismiss, onEntered, onExited, visible]);
  return visible || keepMounted ? React.createElement(PanelPresenceContext.Provider,
    { value: { visible, rendered: visible } },
    React.createElement("div", { role: "dialog", "aria-hidden": !visible }, children)) : null;
};
const PanelHeader = ({ title }) => React.createElement("div", null, title);
const LazyMount = ({ active, children }) => (active ? children() : null);
const ContextMenu = ({ visible, anchor, children }) => {
  if (visible) { counts.menuAnchor = anchor; counts.menuContent = children; }
  return visible ? React.createElement("div", { role: "dialog" }, children) : null;
};
const ContextMenuItem = (props) => {
  counts.actionItemRenders++;
  return React.createElement("button", { onClick: props.onPress }, props.label);
};
const HeaderIconButton = ({ accessibilityLabel, onPress, name }) => {
  const button = React.createElement("button", {
    "data-icon": name,
    onClick: () => onPress?.({ x: 1, y: 2, width: 10, height: 10 }),
  }, name);
  if (accessibilityLabel === "Reader settings") counts.settingsButton = button;
  return button;
};
const Header = ({ title, right }) => {
  counts.headerRenders += 1;
  return React.createElement("header", null, title, right);
};
const ThemedScrollView = React.forwardRef(function ThemedScrollView(props, ref) {
  counts.scrollProps = props;
  React.useImperativeHandle(ref, () => ({ scrollTo() {}, getInnerViewNode: () => null }), []);
  return React.createElement("div", null, props.children);
});
const noop = () => {};
const stable = (value) => value;

const stubs = {
  react: React,
  "react-dom/client": { createRoot },
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": reactNative,
  "react-native-reanimated": reanimated,
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  "expo-status-bar": { StatusBar: () => null, setStatusBarStyle: noop },
  "../../theme/use-system-color-scheme": { useSystemColorScheme: () => "dark" },
  "../../hooks/use-scene-column-insets": { useSceneColumnInsets: () => ({ sceneWidth: 390 }) },
  "../ui/MaterialIcon": { MaterialIcon: (props) => React.createElement("i", null, props.name) },
  "../../hooks/use-app-router": { useAppRouter: () => ({ canGoBack: () => false, back: noop, replace: noop }) },
  "../ui/Header": { Header, HeaderActions: ({ children }) => React.createElement("div", null, children), HeaderIconButton },
  "../ui/ScreenContent": { ScreenContent: ({ children }) => React.createElement("div", null, children) },
  "../ui/Text": { Text },
  "../ui/Button": { Button: ({ label, onPress }) => React.createElement("button", { onClick: onPress }, label) },
  "../ui/EmptyState": { EmptyState: () => null },
  "../ui/Skeleton": Object.assign(() => null, {
    Skeleton: () => null,
    Group: ({ children }) => React.createElement("div", null, children),
    SkeletonGroup: ({ children }) => React.createElement("div", null, children),
  }),
  "../ui/PressableScale": { PressableScale: host("div", "data-viewstyle") },
  "../ui/ThemedScrollView": { ThemedScrollView },
  "../ui/FloatingPanel": { FloatingPanel },
  "../ui/PanelHeader": { PanelHeader },
  "../ui/ContextMenu": { ContextMenu, ContextMenuItem },
  "../ui/SheetActionRow": { sheetMenuStyles: { cancel: {} } },
  "../ui/Segmented": { Segmented },
  "../ui/Toggle": { Toggle },
  "../ui/LazyMount": { LazyMount },
  "../ui/panel-presence": { PanelPresenceContext },
  "./ReaderContents": {
    ReaderContents: React.forwardRef(function ReaderContents(_props, ref) {
      React.useImperativeHandle(ref, () => ({ prepare: noop, open: noop }), []);
      return null;
    }),
  },
  "../tags/EditTagsSheet": { EditTagsSheet: () => { counts.tagEditorRenders++; return null; } },
  "../bookmarks/LockPrompt": { LockPrompt: () => null },
  "../bookmarks/ReminderCustomPanel": { ReminderCustomPanel: () => null },
  "../bookmarks/ReminderFlow": {
    REMINDER_MENU_WIDTH: 320,
    ReminderPresetItems: () => null,
    useSaveReminder: () => ({ save: noop, busy: false }),
  },
  "../../lib/bookmark-reminders": { formatReminderWhen: () => "", reminderClearsOnOpen: () => false },
  "./reader-typography": {
    READER_BODY_SIZE: { small: 15, medium: 17, large: 19, xlarge: 21 },
    resolveReaderFont: (family, weight = "400") => `${family}-${weight}`,
  },
  "../../theme/fonts": fonts,
  "../../theme/ThemeProvider": {
    useTheme: () => ({ palette: appPalette, expressive: true }),
    ThemeOverrideProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  },
  "../../theme/reader-theme": { resolveReaderPalette: (theme) => readerPalettes[theme] ?? readerPalette },
  "../../theme/pin-system-chrome": { pinSystemChrome: () => Promise.resolve() },
  "../../theme/current-app-palette": { currentAppPalette: () => appPalette },
  "../../theme/device-colors": { useDeviceColors: () => null },
  "../ui/LinearProgress": { LinearProgress: () => null },
  "../../lib/query-client": { queryClient: {} },
  "../../lib/api/bookmarks": { bookmarksApi: { update: () => Promise.resolve(null) } },
  "../../lib/cache-helpers": {
    findBookmarkInCache: () => undefined,
    updateBookmarkEverywhere: (_queryClient, _id, updater) => {
      detailStore.set(updater(detailStore.get()));
    },
  },
  "../../hooks/use-bookmarks": {
    useBookmarkDetail: () => {
      const data = React.useSyncExternalStore(detailStore.subscribe, detailStore.get, detailStore.get);
      return { data, isLoading: false, error: null, refetch: noop };
    },
    useCreateHighlight: () => ({ isPending: false, mutate: noop, mutateAsync: () => Promise.resolve() }),
    useUpdateHighlight: () => ({ isPending: false, mutate: noop, mutateAsync: () => Promise.resolve() }),
    useRemoveHighlight: () => ({ isPending: false, mutate: noop, mutateAsync: () => Promise.resolve() }),
    useSetContentKind: () => ({ mutate: noop, isPending: false }),
  },
  "../../hooks/queries": {
    useFolders: () => ({ data: stable([]) }),
    useServerInfo: () => ({ data: stable({ reminders: true }) }),
  },
  "../../hooks/use-reader-preferences": {
    useReaderPreferences: () => {
      const stored = React.useSyncExternalStore(preferencesStore.subscribe, preferencesStore.get, preferencesStore.get);
      return { preferences: stored, setPreferences: preferencesStore.set };
    },
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
  "../../lib/bookmark-reader": {
    bookmarkIsArticle: () => true,
    bookmarkOpensAsWebsite: () => false,
    bookmarkCanBeArticle: () => false,
    canReadInOrdo: () => false,
  },
  "../../lib/copy-link": { copyLink: (url) => { counts.copiedLink = url; return Promise.resolve(); }, copyText: () => Promise.resolve() },
  "../../lib/open-website": { ackBookmarkOpened: noop, openExternalBrowser: noop, openLivePage: noop },
  "../../lib/fab-layout": { fabContentPadding: () => 0 },
  "../../hooks/use-reduced-motion-preference": { useReducedMotionPreference: () => false },
  "../../lib/latest-write-queue": { createLatestWriteQueue: () => () => {} },
  "../../lib/session-scope": {
    captureSessionScope: () => ({ generation: 1 }),
    isSessionScopeCurrent: () => true,
  },
  "../../hooks/use-scene-ready": {
    useSceneReady: () => {
      counts.articleHookCalls += 1;
      return true;
    },
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
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const localRequire = (name) => {
    if (stubs[name]) return stubs[name];
    if (name === "react") return React;
    if (name === "./ArticleHtml") return { ArticleHtml: ArticleHtmlStub };
    if (name.startsWith(".")) return load(resolveLocal(dirname(filename), name));
    if (name === "@ordo/shared") {
      const real = require("@ordo/shared");
      return {
        ...real,
        selectionHighlightState: (...args) => {
          counts.selectionChecks += 1;
          return real.selectionHighlightState(...args);
        },
      };
    }
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

const ReaderPane = load(resolve(sourceRoot, "components/reader/ReaderPane.tsx")).ReaderPane;
const ReaderControlsSheet = load(resolve(sourceRoot, "components/reader/ReaderControlsSheet.tsx")).ReaderControlsSheet;
const activity = load(resolve(sourceRoot, "hooks/use-animation-activity.ts"));
const delay = (ms) => new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
async function settle(ms = 20) {
  await React.act(async () => { await delay(ms); });
}
const delta = (after, before, key) => after[key] - before[key];
const deltasOf = (after, before) => ({
  articleRenders: delta(after, before, "articleRenders"),
  articleHookCalls: delta(after, before, "articleHookCalls"),
  headerRenders: delta(after, before, "headerRenders"),
  selectionChecks: delta(after, before, "selectionChecks"),
});
const segmentedDeltas = (after, before) => Object.fromEntries(
  Object.keys(after).map((label) => [label, after[label] - (before[label] ?? 0)]),
);
function resetSegmentedCounts() {
  for (const key of Object.keys(counts.segmented)) delete counts.segmented[key];
}
function createManualScheduler() {
  const queued = new Map();
  let nextId = 0;
  return {
    schedule(work) {
      const id = ++nextId;
      queued.set(id, work);
      return () => { queued.delete(id); };
    },
    runNext() {
      const first = queued.entries().next().value;
      if (!first) return false;
      queued.delete(first[0]);
      first[1]();
      return true;
    },
    get size() { return queued.size; },
  };
}
async function mountDormantControls(scheduler, scope = activity.createAnimationActivityScope(true)) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = React.createRef();
  await React.act(async () => {
    root.render(React.createElement(activity.AnimationActivityScopeContext.Provider, { value: scope },
      React.createElement(ReaderControlsSheet, {
        ref, effectiveDark: true, workScheduler: scheduler,
      })));
    await delay(0);
  });
  return {
    ref,
    scope,
    async runNext() {
      await React.act(async () => {
        assert.equal(scheduler.runNext(), true, "a queued preparation slice exists");
        await delay(0);
      });
    },
    async unmount() {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

async function mountPane() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(ReaderPane, { bookmarkId: "b1", embedded: true }));
  });
  await settle(80);
  return {
    root,
    counts,
    async unmount() {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

test("progress saves leave the article wrapper and controls panel untouched", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  // Open and close the panel first so a used, closed panel is also covered.
  await React.act(async () => { view.counts.settingsButton?.props.onClick(); });
  await settle(40);
  await React.act(async () => { view.counts.panelDismiss?.(); });
  await settle(20);
  const before = { ...view.counts, segmented: { ...view.counts.segmented } };
  await React.act(async () => { detailStore.set({ ...detailData, readProgress: 0.42 }); });
  await settle();
  const work = deltasOf(view.counts, before);
  assert.equal(work.headerRenders, 1, "reader chrome reflects the changed bookmark row");
  assert.equal(work.articleRenders, 0, "the article renderer is not re-invoked");
  assert.equal(work.articleHookCalls, 0, "the article wrapper's subscriptions stay untouched");
  assert.deepEqual(segmentedDeltas(view.counts.segmented, before.segmented), {
    "Text size": 0, Typeface: 0, "Line spacing": 0, "Reader theme": 0,
  }, "a closed panel does no control work");
});

test("opening settings does not re-render the reader surface", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  const before = { ...view.counts, segmented: { ...view.counts.segmented } };
  await React.act(async () => { view.counts.settingsButton?.props.onClick(); });
  await settle(40);
  const work = deltasOf(view.counts, before);
  assert.equal(work.headerRenders, 0, "the pane does not render just to open the panel");
  assert.equal(work.articleRenders, 0);
  assert.equal(work.articleHookCalls, 0);
  assert.deepEqual(segmentedDeltas(view.counts.segmented, before.segmented), {
    "Text size": 1, Typeface: 1, "Line spacing": 1, "Reader theme": 1,
  }, "the panel mounts its five groups once");
  assert.equal(view.counts.sheetVisible, before.sheetVisible + 1);
  const beforeClose = { ...view.counts };
  await React.act(async () => { view.counts.panelDismiss?.(); });
  await settle(20);
  assert.equal(deltasOf(view.counts, beforeClose).headerRenders, 0, "dismissing the panel does not render the pane");
});

test("overflow navigation and dismissal leave the reader pane untouched", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  const before = { ...view.counts };
  const overflow = [...document.querySelectorAll("button")].find((node) => node.textContent === "ellipsis-horizontal");
  assert.ok(overflow, "reader overflow trigger is mounted");
  await React.act(async () => { overflow.click(); });
  await settle(20);
  assert.ok([...document.querySelectorAll("button")].some((node) => node.textContent === "Highlights"));
  assert.deepEqual(deltasOf(view.counts, before), {
    articleRenders: 0, articleHookCalls: 0, headerRenders: 0, selectionChecks: 0,
  }, "opening overflow does not render the article, header, or pane");
  await React.act(async () => {
    [...document.querySelectorAll("button")].find((node) => node.textContent === "Highlights").click();
  });
  await settle(20);
  assert.ok([...document.querySelectorAll('[role="dialog"]')].some((node) => node.textContent === "HighlightsArticle actions"),
    "the highlights dialog replaced the overflow");
  await React.act(async () => {
    [...document.querySelectorAll("button")].find((node) => node.textContent === "Article actions").click();
  });
  await settle(20);
  await React.act(async () => {
    [...document.querySelectorAll("button")].find((node) => node.textContent === "Copy link").click();
  });
  await settle(20);
  assert.deepEqual(deltasOf(view.counts, before), {
    articleRenders: 0, articleHookCalls: 0, headerRenders: 0, selectionChecks: 0,
  }, "menu/dialog handoff and closing also stay local");
  assert.equal(view.counts.tagEditorRenders, before.tagEditorRenders,
    "overflow/highlights must not reconcile the closed tag editor and its nested creation controls");
});

test("unrelated reader updates preserve measured action identities but invoke the latest callbacks", async (t) => {
  const previous = detailStore.get();
  const view = await mountPane();
  t.after(async () => { await view.unmount(); detailStore.set(previous); });
  await React.act(async () => {
    [...document.querySelectorAll("button")].find(node => node.textContent === "ellipsis-horizontal").click();
  });
  await settle(20);
  const content = view.counts.menuContent;
  const before = view.counts.actionItemRenders;
  const keys = React.Children.toArray(content.props.children).filter(React.isValidElement).map(child => child.key);
  assert.equal(new Set(keys).size, keys.length, "retained rows have unique semantic keys");
  assert.ok(keys.every(key => !/^\.\d+$/.test(key)), "conditional rows must not inherit index-only identities");
  await React.act(async () => detailStore.set({ ...detailData, readProgress: 0.28, url: "https://changed.example.test/latest" }));
  await settle(40);
  assert.equal(view.counts.menuContent, content, "progress/callback changes cannot invalidate a dormant measurement");
  assert.equal(view.counts.actionItemRenders, before, "the animated action rows are not reconciled again");
  await React.act(async () => {
    [...document.querySelectorAll("button")].find(node => node.textContent === "Copy link").click();
  });
  assert.equal(view.counts.copiedLink, "https://changed.example.test/latest", "cached rows use the latest committed article callback");
});

test("a preference press renders the pane once and the panel keeps the optimistic value", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  await React.act(async () => { view.counts.settingsButton?.props.onClick(); });
  await settle(40);
  const before = { ...view.counts, segmented: { ...view.counts.segmented } };
  await React.act(async () => {
    const large = [...document.querySelectorAll("button")].find((node) => node.getAttribute("data-label") === "L");
    assert.ok(large, "the text-size control is mounted");
    large.click();
  });
  await settle(80);
  assert.equal(preferences.fontSize, "large", "the panel reflects the optimistic preference immediately");
  const work = deltasOf(view.counts, before);
  assert.equal(work.headerRenders, 1, "exactly one pane pass, after the deferred content preference lands");
  assert.equal(work.articleRenders, 1, "the article reflows once for the new content preference");
  assert.equal(work.articleHookCalls, 1, "the article wrapper's scene hook renders once");
  assert.equal(document.querySelector('[data-segmented="Text size"] button[aria-checked="true"]')?.getAttribute("data-label"), "L",
    "the panel shows the new choice without waiting for the deferred pane");
});

test("an acknowledged preference write with identical values does no reader work", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  const before = { ...view.counts };
  // The server ack replaces the user object with equal preference values.
  await React.act(async () => { preferencesStore.set({ fontSize: preferences.fontSize }); });
  await settle(40);
  assert.deepEqual(deltasOf(view.counts, before), {
    articleRenders: 0,
    articleHookCalls: 0,
    headerRenders: 0,
    selectionChecks: 0,
  }, "an equal-value preference ack must not reflow the article or rerender chrome");
});

test("a theme-only change restyles chrome without re-rendering the article wrapper", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  const before = { ...view.counts };
  await React.act(async () => { preferencesStore.set({ theme: "light" }); });
  await settle(40);
  const work = deltasOf(view.counts, before);
  assert.equal(work.headerRenders, 1, "the reader surface picks up the new palette");
  assert.equal(work.articleRenders, 0, "theme is not part of the article preference identity");
  assert.equal(work.articleHookCalls, 0, "the article wrapper does not render for a palette-only change");
  // Restore dark for the remaining interactions.
  await React.act(async () => { preferencesStore.set({ theme: "dark" }); });
  await settle(20);
});

test("in-flight previews do not reflow visible controls; only dormant typeface adopts them", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  await React.act(async () => { view.counts.settingsButton?.props.onClick(); });
  await settle(40);
  const before = { ...view.counts, segmented: { ...view.counts.segmented } };
  await React.act(async () => { fonts.arrivePreview("serif"); });
  await settle(20);
  assert.deepEqual(segmentedDeltas(view.counts.segmented, before.segmented), {
    "Text size": 0, Typeface: 0, "Line spacing": 0, "Reader theme": 0,
  }, "a font arrival must not swap or reconcile controls during the entrance");
  assert.equal(deltasOf(view.counts, before).headerRenders, 0, "the panel chrome does not render for a font arrival");
  await React.act(async () => view.counts.panelDismiss());
  await settle(20);
  assert.deepEqual(segmentedDeltas(view.counts.segmented, before.segmented), {
    "Text size": 0, Typeface: 1, "Line spacing": 0, "Reader theme": 0,
  }, "only the hidden typeface group picks up the newly ready face");
  const beforeReopen = { ...view.counts.segmented };
  await React.act(async () => view.counts.settingsButton.props.onClick());
  await settle(20);
  assert.deepEqual(segmentedDeltas(view.counts.segmented, beforeReopen), {
    "Text size": 0, Typeface: 0, "Line spacing": 0, "Reader theme": 0,
  }, "a retained settings opening must not render any animated control group");
});

test("an early first opening still adopts previews after the real entrance completes", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  await React.act(async () => view.counts.settingsButton.props.onClick());
  await settle(20);
  const before = { ...view.counts.segmented };
  const optionsBefore = view.counts.segmentedOptions.Typeface;
  await React.act(async () => fonts.arrivePreview("garamond"));
  await settle(20);
  assert.equal(view.counts.segmented.Typeface - before.Typeface, 0, "opening holds an in-flight font arrival");
  await React.act(async () => view.counts.panelEntered());
  await settle(20);
  assert.deepEqual(segmentedDeltas(view.counts.segmented, before), {
    "Text size": 0, Typeface: 1, "Line spacing": 0, "Reader theme": 0,
  }, "early-open fallback labels do not lose their previews permanently");
  const optionsAfter = view.counts.segmentedOptions.Typeface;
  for (let index = 0; index < optionsBefore.length; index++) {
    if (optionsBefore[index].value !== "garamond") assert.equal(optionsAfter[index].labelStyle, optionsBefore[index].labelStyle,
      "one arriving preview preserves every unchanged segment's style identity");
  }
  const enteredCounts = { ...view.counts.segmented };
  await React.act(async () => view.counts.settingsButton.props.onClick());
  await React.act(async () => fonts.arrivePreview("bitter"));
  await settle(20);
  assert.deepEqual(segmentedDeltas(view.counts.segmented, enteredCounts), {
    "Text size": 0, Typeface: 1, "Line spacing": 0, "Reader theme": 0,
  }, "an already-visible open does not clear entered and permanently pause previews");
});

test("scrolling the open selection menu moves its anchor without re-scanning highlights", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  assert.ok(view.counts.articleProps, "the article painted");
  const beforeSelect = view.counts.selectionChecks;
  await React.act(async () => {
    view.counts.articleProps.onTextSelect({
      exact: "Body 1.", prefix: "", suffix: "",
      anchor: { x: 10, y: 100, width: 20, height: 20 },
    });
  });
  await settle(320);
  assert.equal(view.counts.selectionChecks - beforeSelect, 1, "opening the menu scans once");
  const openedAnchor = view.counts.menuAnchor?.y;
  const beforeScroll = view.counts.selectionChecks;
  for (const offset of [50, 90]) {
    await React.act(async () => {
      view.counts.scrollProps.onScroll({
        nativeEvent: {
          contentOffset: { y: offset },
          contentSize: { height: 10000 },
          layoutMeasurement: { height: 800 },
        },
      });
    });
    await settle(5);
  }
  assert.equal(view.counts.selectionChecks - beforeScroll, 0, "anchor-only scroll updates do not rescan the article");
  assert.ok(view.counts.menuAnchor && openedAnchor != null && view.counts.menuAnchor.y !== openedAnchor,
    "the selection menu still follows the scroll");
});

test("highlight changes still reach the article", async (t) => {
  const view = await mountPane();
  t.after(() => view.unmount());
  const before = { ...view.counts };
  await React.act(async () => {
    detailStore.set({
      ...detailData,
      highlights: [{
        id: "h1", exact: "Body 2.", prefix: "", suffix: "", href: null,
        createdAt: "2026-10-20T12:00:00Z",
      }],
    });
  });
  await settle(40);
  const work = deltasOf(view.counts, before);
  assert.equal(work.articleRenders, 1, "a new highlight re-renders the article renderer");
  assert.equal(work.articleHookCalls, 1, "the wrapper's scene hook renders once for the changed prop");
});

test("dormant reader settings stage one stable group per idle slice", async (t) => {
  resetSegmentedCounts();
  for (const family of fonts.READER_FONT_FAMILY_LIST) previewReady.add(family);
  const scheduler = createManualScheduler();
  const controls = await mountDormantControls(scheduler);
  try {
    await React.act(async () => { controls.ref.current.prepare(); await delay(0); });
    assert.equal(scheduler.size, 1, "preparation is scheduled as one idle slice");
    await controls.runNext();
    assert.deepEqual(counts.segmented, { "Text size": 1 }, "the first group is the only dormant body");
    assert.equal(scheduler.size, 1, "the next group waits for its own idle slice");

    await React.act(async () => { controls.scope.setActive(false); await delay(0); });
    assert.equal(scheduler.size, 0, "the real background scope cancels the next group");
    await React.act(async () => { controls.scope.setActive(true); await delay(0); });
    assert.equal(scheduler.size, 1, "uncovering resumes exactly one idle slice");

    await controls.runNext();
    assert.deepEqual(counts.segmented, { "Text size": 1, Typeface: 1 },
      "the appended group does not remount the first group");
    assert.equal(scheduler.size, 1);

    await controls.runNext();
    assert.deepEqual(counts.segmented, { "Text size": 1, Typeface: 1, "Line spacing": 1 });
    await controls.runNext();
    assert.deepEqual(counts.segmented, {
      "Text size": 1, Typeface: 1, "Line spacing": 1, "Reader theme": 1,
    });
    await controls.runNext();
    assert.equal(scheduler.size, 0, "all five groups are prepared");
    assert.equal(document.querySelectorAll('[data-toggle="1"]').length, 1,
      "the AMOLED row is the fifth group");
  } finally {
    await controls.unmount();
  }
});

test("dormant preview prefetch waits for groups; visible entrance registers later", async (t) => {
  resetSegmentedCounts();
  previewReady.clear();
  counts.previewBatches = 0;
  counts.previewPreloads = 0;
  const scheduler = createManualScheduler();
  const controls = await mountDormantControls(scheduler);
  try {
    await React.act(async () => { controls.ref.current.prepare(); await delay(0); });
    await controls.runNext(); // prepared body, group 1
    await controls.runNext(); // group 2
    await controls.runNext(); // group 3
    await controls.runNext(); // group 4
    assert.equal(counts.previewPreloads, 0, "no prefetch while groups are still mounting");
    assert.equal(counts.previewBatches, 0);
    assert.equal(scheduler.size, 1, "the final group slice is queued");
    await controls.runNext(); // group 5; schedules the dormant prefetch
    assert.equal(counts.previewPreloads, 0, "prefetch is not run inside the group slice");
    assert.equal(counts.previewBatches, 0);
    assert.equal(scheduler.size, 1, "one prefetch follows the completed group series");
    await controls.runNext();
    assert.equal(counts.previewPreloads, 1, "dormant work fetches/decodes only");
    assert.equal(counts.previewBatches, 0, "dormant work never registers fonts");
    assert.equal(scheduler.size, 0);

    await React.act(async () => { controls.ref.current.open(); await delay(0); });
    assert.equal(counts.previewBatches, 0, "opening before entrance does not register");
    await React.act(async () => { counts.panelEntered?.(); await delay(0); });
    assert.equal(scheduler.size, 1, "the visible entrance schedules registration");
    await controls.runNext();
    assert.equal(counts.previewBatches, 1, "registration runs only after the entrance");
    assert.equal(counts.previewPreloads, 1, "prefetch is not repeated");
    assert.equal(scheduler.size, 0);
  } finally {
    await controls.unmount();
  }
});

test("urgent reader settings open renders all groups, cancels staging, and retains them", async (t) => {
  resetSegmentedCounts();
  for (const family of fonts.READER_FONT_FAMILY_LIST) previewReady.add(family);
  const scheduler = createManualScheduler();
  const controls = await mountDormantControls(scheduler);
  try {
    await React.act(async () => { controls.ref.current.prepare(); await delay(0); });
    await controls.runNext();
    await controls.runNext();
    assert.deepEqual(counts.segmented, { "Text size": 1, Typeface: 1 },
      "only two groups are prepared before the urgent open");
    assert.equal(scheduler.size, 1, "a third group is still queued");

    await React.act(async () => { controls.ref.current.open(); await delay(0); });
    assert.deepEqual(counts.segmented, {
      "Text size": 1, Typeface: 1, "Line spacing": 1, "Reader theme": 1,
    }, "the first visible commit appends every remaining group");
    assert.equal(document.querySelectorAll('[data-toggle="1"]').length, 1);
    assert.equal(scheduler.size, 0, "opening cancels the dormant staging slice");

    const opened = { ...counts.segmented };
    await React.act(async () => { counts.panelDismiss(); await delay(0); });
    await React.act(async () => { controls.ref.current.open(); await delay(0); });
    assert.deepEqual(counts.segmented, opened, "reopening retains every mounted control");
    assert.equal(scheduler.size, 0, "a retained panel does not restart staging");
  } finally {
    await controls.unmount();
  }
});

test("opening overflow never renders a hidden large highlight collection", async (t) => {
  const previous = detailStore.get();
  detailStore.set({ ...previous, highlights: Array.from({ length: 500 }, (_, index) => ({
    id: `large-${index}`, exact: `Saved passage ${index}.`, prefix: "", suffix: "", href: null,
    createdAt: "2026-10-20T12:00:00Z",
  })) });
  const view = await mountPane();
  t.after(async () => { await view.unmount(); detailStore.set(previous); });
  const before = { ...view.counts };
  await React.act(async () => {
    [...document.querySelectorAll("button")].find((node) => node.textContent === "ellipsis-horizontal").click();
  });
  await settle(20);
  assert.equal(view.counts.textRenders - before.textRenders, 0,
    "none of the hidden highlights or article text is rendered for overflow");
  assert.equal(document.body.textContent.includes("Saved passage 499."), false);
});
