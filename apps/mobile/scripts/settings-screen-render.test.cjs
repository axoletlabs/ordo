/**
 * Run with: node --test apps/mobile/scripts/settings-screen-render.test.cjs
 *
 * Actual-source render work for the settings screens. The real AppearancePage,
 * AccountPage and AboutPage sources run on React DOM in jsdom; only platform
 * leaves (react-native hosts, Reanimated, icons, router, query hooks) are
 * stubbed.
 *
 * Audited costs (same harness, HEAD 42ca039 before these edits):
 *  - Appearance: an unrelated settings change re-rendered the retained panel
 *    (1 commit / 38 created elements). It now does no work (0 / 0), while a
 *    theme change still renders it (1 / 38).
 *  - About: an Android update-progress tick re-rendered all groups
 *    (1 commit / 54 elements). It now does nothing (0 / 0). An OTA metadata
 *    tick still updates the Running group, but only inside that boundary
 *    (1 / 14 instead of 1 / 54).
 *  - Account: a server-info refresh re-rendered the whole page
 *    (1 commit / 27 elements). It now does nothing (0 / 0). Opening the avatar
 *    menu re-renders only its own subtree (8 elements, no account rows instead
 *    of 27 elements including every row).
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("../../../node_modules/react");
const { createRoot } = require("../../../node_modules/react-dom/client");
const { JSDOM } = require("../../../node_modules/jsdom");
const { create: createStore } = require("zustand");
const { useShallow } = require("zustand/react/shallow");

const root = resolve(__dirname, "..");
const sourceRoot = resolve(root, "src");
const appRoot = resolve(root, "app");
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

// Count element construction so a commit's breadth is observable, not just
// whether React called a Profiler callback.
let created = 0;
const jsxRuntime = require("react/jsx-runtime");
const countedRuntime = {
  ...jsxRuntime,
  jsx: (...args) => { created++; return jsxRuntime.jsx(...args); },
  jsxs: (...args) => { created++; return jsxRuntime.jsxs(...args); },
};

const flattenStyle = style => {
  if (style == null) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style;
};
const kebab = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
function host(tag) {
  return React.forwardRef(function Host({ children, style, dataSet, onLayout, pointerEvents, onPress, accessibilityLabel, ...rest }, ref) {
    const domProps = { ref };
    if (rest.id) domProps.id = rest.id;
    if (rest.role) domProps.role = rest.role;
    if (rest.accessibilityRole) domProps.role = rest.accessibilityRole;
    if (rest.testID) domProps["data-testid"] = rest.testID;
    if (accessibilityLabel) domProps["aria-label"] = accessibilityLabel;
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("aria-") || key.startsWith("data-")) domProps[key] = value;
    }
    for (const [key, value] of Object.entries(dataSet ?? {})) domProps[`data-${kebab(key)}`] = String(value);
    if (onPress) domProps.onClick = onPress;
    void style; void onLayout; void pointerEvents;
    return React.createElement(tag, domProps, children);
  });
}
const reactNative = {
  Platform: { OS: "web", select: options => options.web ?? options.default },
  View: host("div"),
  Text: host("span"),
  Pressable: host("div"),
  ScrollView: host("div"),
  Image: host("img"),
  Linking: { openURL: async () => {} },
  useColorScheme: () => "dark",
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
  StyleSheet: { create: styles => styles, flatten: flattenStyle, absoluteFill: {}, hairlineWidth: 1 },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  Keyboard: { addListener: () => ({ remove() {} }), metrics: () => null, dismiss: () => {}, isVisible: () => false },
  Appearance: { getColorScheme: () => "dark", setColorScheme: () => {}, addChangeListener: () => ({ remove() {} }) },
  I18nManager: { isRTL: false },
  NativeModules: {},
  Alert: { alert: () => {} },
  Share: { share: async () => {} },
  findNodeHandle: () => 1,
};
reactNative.default = reactNative;

const reanimated = {
  useSharedValue(initial) { const slot = React.useRef(null); if (slot.current === null) slot.current = { value: initial }; return slot.current; },
  useAnimatedStyle: () => ({}),
  useAnimatedProps: () => ({}),
  withTiming: value => value,
  withSpring: value => value,
  withRepeat: value => value,
  cancelAnimation: () => {},
  runOnJS: callback => callback,
  interpolate: value => value,
  interpolateColor: () => "#000",
  Easing: { quad: value => value, inOut: fn => fn, in: fn => fn, out: fn => fn, bezier: () => value => value, linear: value => value },
  ReduceMotion: { Never: "never" },
};
reanimated.default = { View: reactNative.View, createAnimatedComponent: component => component, ...reanimated };

const palette = new Proxy({ mode: "dark" }, { get: (target, key) => target[key] ?? `#${String(key)}` });
const themeState = { palette, shadows: { level2: {} }, expressive: true };
const motion = { reducedMotion: false, spatial: { stiffness: 700 }, expressive: true, fast: {} };

const settingsStore = createStore(() => ({
  serverUrl: "https://api.ordo.axolet.com",
  themeMode: "system",
  amoled: false,
  expressive: true,
  materialYouColors: false,
  themeContrast: 0,
  navigationAnimation: "slide",
  createButtonTapAction: "bookmark",
  createButtonHoldAction: "menu",
  websiteBrowser: "ordo",
  forceWebsiteDark: false,
  shareQuickBookmark: false,
  shareShowQuickAction: false,
  hapticsEnabled: true,
  consoleOtpTipDismissed: false,
  hydrated: true,
  setThemeMode: () => {}, setAmoled: () => {}, setExpressive: () => {}, setMaterialYouColors: () => {},
  setThemeContrast: () => {}, setNavigationAnimation: () => {}, setCreateButtonTapAction: () => {},
  setCreateButtonHoldAction: () => {}, setWebsiteBrowser: () => {}, setForceWebsiteDark: () => {},
  setShareQuickBookmark: () => {}, setShareShowQuickAction: () => {}, setHapticsEnabled: () => {},
  dismissConsoleOtpTip: () => {},
}));

const loadUser = {
  id: "u1", displayName: "Test User", email: "test@example.com", emailVerified: true, hasAvatar: true,
  mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z", preferences: {},
};
const authStore = createStore(() => ({ user: loadUser, setUser: () => {}, status: "authenticated" }));

const nativeStore = createStore(() => ({
  hydrated: true, status: "available",
  release: {
    version: "0.4.0", tagName: "v0.4.0", name: "ordo 0.4.0", body: "", prerelease: false,
    publishedAt: "2026-10-01T00:00:00Z", pageUrl: "https://github.com/axoletlabs/ordo/releases",
    apkUrl: "https://github.com/axoletlabs/ordo/releases/download/v0.4.0/ordo.apk", apkSize: 12345678,
  },
  progress: 0, receivedBytes: 0, downloadedUri: null, showProgress: false, installing: false,
  installPermissionLikely: false, error: null, lastChecked: 1,
  hydrate: async () => {}, check: async () => null, downloadAndInstall: async () => {}, install: async () => {},
  cancelDownload: () => {}, dismissDownload: () => {},
}));

let otaSnapshot = {
  enabled: true, status: "idle", message: null, channel: "preview", runtimeVersion: "fingerprint-1",
  isEmbeddedLaunch: true, runningUpdateId: null, runningUpdateCreatedAt: null,
  pendingUpdateId: null, pendingUpdateCreatedAt: null, availableUpdateId: null,
  availableUpdateCreatedAt: null, lastChecked: null, downloadProgress: undefined,
};
const otaListeners = new Set();
function useOtaUpdate() {
  return React.useSyncExternalStore(
    listener => { otaListeners.add(listener); return () => otaListeners.delete(listener); },
    () => otaSnapshot,
  );
}
function tickOta(patch) {
  otaSnapshot = { ...otaSnapshot, ...patch };
  for (const listener of otaListeners) listener();
}

let serverInfoSnapshot = { data: { profilePictureMaxBytes: 2097152, smtpConfigured: true }, error: null, isFetching: false };
const infoListeners = new Set();
function useServerInfo() {
  return React.useSyncExternalStore(
    listener => { infoListeners.add(listener); return () => infoListeners.delete(listener); },
    () => serverInfoSnapshot,
  );
}
function tickServerInfo(patch) {
  serverInfoSnapshot = { ...serverInfoSnapshot, ...patch };
  for (const listener of infoListeners) listener();
}

const rowRenders = [];
const stubs = new Map();
const modules = new Map();
const bareStubs = {
  "react": React,
  "react/jsx-runtime": countedRuntime,
  "react-native": reactNative,
  "react-native-reanimated": reanimated,
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), SafeAreaProvider: ({ children }) => children },
  "react-native-gesture-handler": { Gesture: {}, GestureDetector: ({ children }) => children, Pressable: reactNative.Pressable },
  "zustand/react/shallow": { useShallow },
};
function stub(relative, exports_) { stubs.set(resolve(sourceRoot, relative), exports_); }

stub("theme/ThemeProvider.tsx", { useTheme: () => themeState, ThemeProvider: ({ children }) => children });
stub("theme/material-motion.ts", { useMaterialMotion: () => motion, materialMotion: {} });
stub("theme/device-colors.ts", { materialYouAvailable: true, useDeviceColors: () => null });
stub("theme/icon-glyph.ts", { iconGlyphStyle: () => ({}) });
stub("theme/pin-system-chrome.ts", { pinWindowBackground: () => {} });
stub("theme/scrollbar.ts", { scrollbarColors: () => ({}), WEB_SCROLLBAR_CSS: "" });
stub("theme/state-layer.ts", { alphaTint: () => "#000", opaqueComponents: () => ({}), stateLayerCorners: () => ({}), stateLayerOpacity: () => 0 });
stub("lib/haptics.ts", { haptics: { light: () => {}, medium: () => {}, heavy: () => {}, success: () => {}, error: () => {}, selection: () => {} }, setHapticsEnabled: () => {} });
stub("lib/hosting.ts", {
  DEFAULT_SERVER_URL: "https://api.ordo.axolet.com",
  CLOUD_SERVER_URL: "https://api.ordo.axolet.com",
  CLOUD_DISPLAY_NAME: "ordo Cloud",
  CLOUD_WEBSITE_URL: "https://ordo.axolet.com",
  CLOUD_TERMS_URL: "https://ordo.axolet.com/terms",
  CLOUD_PRIVACY_URL: "https://ordo.axolet.com/privacy",
  canonicalizeServerUrl: value => value,
  isCloudServerUrl: () => true,
  hostingModeOf: () => "cloud",
  resolvePersistedServerUrl: value => value ?? "https://api.ordo.axolet.com",
});
stub("lib/share-targets.ts", { patchQuickShareSessionServerUrl: async () => {}, syncQuickShareFlags: async () => {} });
stub("lib/storage.ts", { prefsGet: async () => null, prefsSet: async () => {}, prefsDelete: async () => {}, StorageKeys: {} });
stub("hooks/queries.ts", {
  useServerInfo,
  useSessions: () => ({ data: [], isLoading: false, error: null, refetch: () => {} }),
  useFolders: () => ({ data: [] }),
});
stub("hooks/use-app-router.ts", { useAppRouter: () => ({ push: () => {}, back: () => {}, replace: () => {}, canGoBack: () => true }) });
stub("hooks/use-scene-column-insets.ts", { useColumnPadding: () => ({ left: 0, right: 0 }) });
stub("hooks/use-floating-dock-metrics.ts", { useFloatingDockMetrics: () => ({ visible: false, clearance: 40 }) });
stub("hooks/use-build-info.ts", { useBuildInfo: () => ({ version: "0.3.0", releaseVersion: "0.3.0", gitHash: "42ca039abcdef", gitHashShort: "42ca039", gitDirty: false }) });
stub("hooks/use-ota-update.ts", { useOtaUpdate });
stub("hooks/use-auth-actions.ts", {
  useLogout: () => ({ isPending: false, mutate: () => {} }),
  useDisableTotp: () => ({ mutateAsync: async () => ({}) }),
  useRegenerateBackupCodes: () => ({ mutateAsync: async () => ({ backupCodes: [] }) }),
});
stub("store/settings.ts", { useSettingsStore: settingsStore, DEFAULT_SERVER_URL: "https://api.ordo.axolet.com" });
stub("store/auth.ts", { useAuthStore: authStore });
stub("store/native-update.ts", { useNativeUpdateStore: nativeStore });
stub("store/folder-tokens.ts", { useFolderTokenStore: createStore(() => ({ accessRevision: 0, get: () => null })) });
stub("components/ui/PressableScale.tsx", {
  PressableScale: React.forwardRef(function PressableScaleStub({ children, onPress, disabled, accessibilityLabel }, ref) {
    return React.createElement("button", { ref, "aria-label": accessibilityLabel, disabled, onClick: onPress }, children);
  }),
});
stub("components/ui/MaterialIcon.tsx", { MaterialIcon: Object.assign(({ name }) => React.createElement("span", { "data-icon": name }), { glyphMap: {} }), materialIconName: name => name });
stub("components/ui/Spinner.tsx", { Spinner: () => React.createElement("span"), spinnerExtent: () => 20 });
stub("components/ui/Text.tsx", { Text: ({ children }) => React.createElement("span", null, children) });
stub("components/ui/ThemedScrollView.tsx", {
  ThemedScrollView: React.forwardRef(function ThemedScrollViewStub({ children }, ref) { return React.createElement("div", { ref }, children); }),
  ThemedFlatList: () => React.createElement("div"),
});
stub("components/ui/ScrollBar.tsx", { useScrollBarInsets: () => ({}) });
stub("components/ui/Header.tsx", { Header: ({ title, right }) => React.createElement("div", null, React.createElement("span", null, title), right) });
stub("components/ui/AutofillForm.tsx", { AutofillForm: ({ children }) => React.createElement("div", null, children) });
stub("components/ui/SettingRow.tsx", {
  SettingRow: React.forwardRef(function SettingRowStub({ label, value, right, description, onPress }, ref) {
    rowRenders.push(label);
    return React.createElement("div", { ref, "data-row": label, onClick: onPress },
      React.createElement("span", null, label),
      description ? React.createElement("span", null, description) : null,
      value ? React.createElement("span", null, value) : null,
      right ?? null);
  }),
});
stub("components/settings/SettingsSelect.tsx", { SettingsSelect: ({ title, value }) => React.createElement("span", { "data-select": title }, value) });
stub("components/ui/Toggle.tsx", { Toggle: ({ value, accessibilityLabel }) => React.createElement("span", { role: "switch", "aria-checked": value, "aria-label": accessibilityLabel }) });
stub("components/ui/Segmented.tsx", { Segmented: ({ value }) => React.createElement("span", { "data-segmented": value }) });
stub("components/ui/Button.tsx", { Button: ({ label, onPress, loading, disabled }) => React.createElement("button", { onClick: onPress, disabled: disabled || loading }, label) });
stub("components/ui/ConfirmDialog.tsx", { ConfirmDialog: ({ visible, title, children }) => visible ? React.createElement("div", { role: "dialog" }, title, children) : null });
stub("components/ui/UserAvatar.tsx", { UserAvatar: () => React.createElement("span", { "data-avatar": true }) });
stub("components/ui/ContextMenu.tsx", {
  ContextMenu: ({ visible, children }) => visible ? React.createElement("div", { role: "menu" }, children) : null,
  ContextMenuItem: ({ label, onPress }) => React.createElement("button", { onClick: onPress, role: "menuitem" }, label),
});
stub("components/ui/toast-store.ts", { toast: { success: () => {}, error: () => {} } });
stub("components/ui/FloatingPanel.tsx", { FloatingPanel: ({ visible, children }) => visible ? React.createElement("div", { role: "dialog" }, children) : null });
stub("components/ui/PanelHeader.tsx", { PanelHeader: ({ title }) => React.createElement("div", null, title) });
stub("components/ui/SheetActionRow.tsx", { PanelActions: ({ confirmLabel, onConfirm }) => React.createElement("button", { onClick: onConfirm }, confirmLabel) });
stub("components/ui/OtaUpdater.tsx", { OtaUpdateCard: () => React.createElement("div", { "data-ota-card": true }) });
stub("components/settings/ChangelogList.tsx", { ChangelogSheet: ({ visible }) => visible ? React.createElement("div") : null });
stub("components/ui/FormError.tsx", { FormError: ({ message }) => message ? React.createElement("span", null, message) : null });
stub("components/auth/BackupCodesDialog.tsx", { BackupCodesDialog: () => null });
stub("components/auth/MfaSetupPanel.tsx", { MfaSetupPanel: () => React.createElement("div") });
stub("components/auth/MfaStepUpPanel.tsx", { MfaStepUpPanel: () => null });
stub("lib/api/auth.ts", { authApi: { uploadAvatar: async () => loadUser, deleteAvatar: async () => loadUser, totpBegin: async () => ({}), totpConfirm: async () => ({ user: loadUser, backupCodes: [] }) } });
stub("lib/avatar-upload.ts", { profilePicturePart: async uri => ({ body: uri, size: 1000 }) });
stub("lib/error-message.ts", { errorMessage: error => String(error?.message ?? error ?? "error"), isMfaInvalidError: () => false, isMfaRequiredError: () => false });
stub("lib/format.ts", { formatDate: () => "Jan 1, 2026", timeAgo: () => "now" });
stub("lib/menu-anchor.ts", { measureAnchor: (_node, callback) => callback({ x: 10, y: 10, width: 20, height: 20 }) });
stub("lib/app-variant.ts", { APP_VARIANT: "preview", APP_IDENTITY: { package: "com.ordo.preview" } });
stub("lib/release-name.ts", { releaseName: value => value });
stub("lib/instance-name.ts", { hostOf: value => value, instanceNameOf: () => "ordo" });
stub("lib/server-probe.ts", { describeProbeField: () => ({ error: undefined, helper: undefined }), normalizeServerUrl: value => value, probeServer: async () => ({ status: "down" }) });
stub("lib/query-client.ts", { queryClient: { getQueryData: () => undefined, setQueryData: () => {} } });
stub("lib/api/query-keys.ts", { qk: { serverInfo: () => ["server", "info"] } });
stub("lib/api/server.ts", { serverApi: { rename: async () => ({}) } });
stub("hooks/use-commit-server-switch.ts", { useCommitServerSwitch: () => ({ commit: async () => true, busy: false }) });
stub("hooks/use-session-mutation.ts", { useSessionMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, variables: undefined, reset: () => {} }) });

bareStubs["expo-image-picker"] = { requestMediaLibraryPermissionsAsync: async () => ({ granted: true }), requestCameraPermissionsAsync: async () => ({ granted: true }), launchImageLibraryAsync: async () => ({ canceled: true }), launchCameraAsync: async () => ({ canceled: true }), MediaTypeOptions: { Images: "images" } };
bareStubs["expo-image-manipulator"] = { manipulateAsync: async () => ({ uri: "file://image.jpg" }), SaveFormat: { JPEG: "jpeg" } };
bareStubs["expo-clipboard"] = { setStringAsync: async () => true };
bareStubs["expo-router"] = { useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {}, canGoBack: () => true }), useLocalSearchParams: () => ({}), useFocusEffect: () => {}, Link: ({ children }) => children };
bareStubs["expo-constants"] = { default: { expoConfig: { extra: {}, version: "0.3.0" }, nativeAppVersion: "0.3.0" } };
bareStubs["expo-status-bar"] = { StatusBar: () => null };
bareStubs["expo-updates"] = { useUpdates: () => ({}), runtimeVersion: "fingerprint-1", channel: "preview" };

function resolveLocal(from, name) {
  for (const candidate of [name, `${name}.tsx`, `${name}.ts`, `${name}.json`, `${name}/index.tsx`, `${name}/index.ts`]) {
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

const AppearanceScreen = load(resolve(appRoot, "(app)/settings/appearance.tsx")).default;
const AccountScreen = load(resolve(appRoot, "(app)/settings/account.tsx")).default;
const AboutScreen = load(resolve(appRoot, "(app)/settings/about.tsx")).default;

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

async function renderWork(element, trigger) {
  const work = { commits: 0, created: 0, rows: [] };
  const tree = mount();
  await tree.render(React.createElement(React.Profiler, { id: "screen", onRender: () => { work.commits += 1; } }, element));
  await act(async () => {});
  work.commits = 0;
  created = 0;
  rowRenders.length = 0;
  await act(async () => { await trigger(tree.container); });
  await act(async () => {});
  work.created = created;
  work.rows = rowRenders.slice();
  await tree.unmount();
  return work;
}

test("Appearance ignores unrelated settings updates", async () => {
  const response = await renderWork(React.createElement(AppearanceScreen), () => {
    settingsStore.setState({
      consoleOtpTipDismissed: true,
      websiteBrowser: "external",
      serverUrl: "https://other.example",
    });
  });
  assert.deepEqual(response, { commits: 0, created: 0, rows: [] });
  settingsStore.setState({ consoleOtpTipDismissed: false, websiteBrowser: "ordo", serverUrl: "https://api.ordo.axolet.com" });
});

test("Appearance still applies theme changes", async () => {
  const tree = mount();
  await tree.render(React.createElement(AppearanceScreen));
  created = 0;
  rowRenders.length = 0;
  await act(async () => { settingsStore.setState({ themeMode: "dark" }); });
  assert.ok(created >= 30, `theme update renders the page (${created} elements)`);
  assert.equal(tree.container.querySelector('[data-select="Theme"]').textContent, "dark");
  await tree.unmount();
  settingsStore.setState({ themeMode: "system" });
});

test("About ignores native update progress ticks", async () => {
  const response = await renderWork(React.createElement(AboutScreen), () => {
    nativeStore.setState({ progress: 0.42, receivedBytes: 4_000_000 });
  });
  assert.deepEqual(response, { commits: 0, created: 0, rows: [] });
  nativeStore.setState({ progress: 0, receivedBytes: 0 });
});

test("About keeps OTA metadata inside the Running group", async () => {
  const response = await renderWork(React.createElement(AboutScreen), () => {
    tickOta({
      downloadProgress: 0.3,
      status: "downloading",
      isEmbeddedLaunch: false,
      runningUpdateCreatedAt: new Date("2026-10-01T00:00:00Z"),
    });
  });
  assert.equal(response.commits, 1, "the OTA subscriber still updates");
  assert.ok(response.created <= 18, `only the Running boundary renders (${response.created} elements)`);
  assert.deepEqual(response.rows, ["Origin", "Channel", "Published", "Build fingerprint"]);
  tickOta({ downloadProgress: undefined, status: "idle", isEmbeddedLaunch: true, runningUpdateCreatedAt: null });
});

test("About keeps the fingerprint dialog reachable", async () => {
  const tree = mount();
  await tree.render(React.createElement(AboutScreen));
  const row = tree.container.querySelector('[data-row="Build fingerprint"]');
  assert.ok(row, "the fingerprint row is rendered");
  await act(async () => { row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.ok(tree.container.querySelector('[role="dialog"]'), "tapping the row opens its dialog");
  assert.match(tree.container.textContent, /fingerprint-1/);
  await tree.unmount();
});

test("Account ignores server-info refreshes", async () => {
  const response = await renderWork(React.createElement(AccountScreen), () => {
    tickServerInfo({ data: { profilePictureMaxBytes: 4_194_304, smtpConfigured: true } });
  });
  assert.deepEqual(response, { commits: 0, created: 0, rows: [] });
});

test("Account opens the avatar menu without rebuilding account rows", async () => {
  const response = await renderWork(React.createElement(AccountScreen), container => {
    const button = container.querySelector('button[aria-label="Profile picture"]');
    assert.ok(button, "the avatar is pressable");
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(response.commits, 1, "the menu opens");
  assert.ok(response.created <= 10, `only the avatar subtree renders (${response.created} elements)`);
  assert.deepEqual(response.rows, [], "no account row is rebuilt");

  const tree = mount();
  await tree.render(React.createElement(AccountScreen));
  const button = tree.container.querySelector('button[aria-label="Profile picture"]');
  await act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.ok(tree.container.querySelector('[role="menu"]'), "the photo menu is shown");
  for (const label of ["Choose photo", "Take photo", "Remove photo"]) {
    assert.match(tree.container.textContent, new RegExp(label));
  }
  await tree.unmount();
});
