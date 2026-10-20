const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { create } = require("zustand");
const ts = require("typescript");

test("preference saves do not rerender the router; MFA and sign-out still react", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const useAuthStore = create(() => ({ status: "authenticated", user: { id: "user", mfaEnabled: true, preferences: { fontSize: "medium" } } }));
  const palette = { background: "#000000" };
  const serverInfo = { data: { mfaRequired: true } };
  let stackRenders = 0;
  const screenLayouts = [];
  const enabledHistory = [];
  const View = ({ children }) => React.createElement("div", null, children);
  function Stack({ children, screenLayout }) { stackRenders++; screenLayouts.push(screenLayout); return React.createElement(View, null, children); }
  Stack.Screen = () => null;
  const mocks = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { Platform: { OS: "android" }, View },
    "expo-router": { Stack }, "react-native-screens": { enableFreeze() {} },
    "react-native-reanimated": { __esModule: true, default: { View }, useAnimatedStyle: fn => fn(),
      useSharedValue: initial => React.useRef({ value: initial }).current, withTiming: value => value },
    "../../src/hooks/use-reduced-motion-preference": { useReducedMotionPreference: () => false },
    "../../src/theme/ThemeProvider": { useTheme: () => ({ palette }) },
    "../../src/hooks/queries": { useServerInfo: () => serverInfo, useValidateSession() {} },
    "../../src/store/auth": { useAuthStore },
    "../../src/lib/navigation-animation": { screenAnimationDuration: () => 200, stackScreenAnimation: () => "default" },
    "../../src/lib/navigation-animation-policy": { resolveStackNavigationAnimation: value => value },
    "../../src/store/settings": { useSettingsStore: selector => selector({ navigationAnimation: "default" }) },
    "../../src/components/auth/MfaEnrollmentScreen": { MfaEnrollmentScreen: () => React.createElement("span", null, "Enroll MFA") },
    "../../src/components/bookmarks/ReminderNotificationHost": { ReminderNotificationHost: () => null },
    "../../src/components/ui/PageTransition": { PageTransition: View },
    "../../src/components/settings/ChangelogAnnouncementHost": { ChangelogAnnouncementHost: ({ enabled }) => { enabledHistory.push(enabled); return null; } },
    "../../src/hooks/use-overlay-focus": { useOverlayFocus: () => React.useRef(null) },
    "../../src/hooks/use-animation-activity": { AnimationActivityContext: React.createContext(true), useAnimationActivity: () => true },
  };
  const filename = process.env.ORDO_APP_LAYOUT_SOURCE ?? resolve(__dirname, "../app/(app)/_layout.tsx");
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, mod, mod.exports);
  const root = createRoot(dom.window.document.getElementById("root"));
  const update = patch => React.act(() => useAuthStore.setState(patch));
  try {
    await React.act(() => root.render(React.createElement(mod.exports.default)));
    const initialRenders = stackRenders;
    for (let index = 0; index < 8; index++) await update(state => ({ user: { ...state.user, preferences: { fontSize: index % 2 ? "medium" : "large" } } }));
    assert.equal(stackRenders, initialRenders, "eight preference acknowledgements must not rerender the entire navigation stack");
    await update(state => ({ user: { ...state.user, displayName: "New name" } }));
    assert.equal(stackRenders, initialRenders);
    await update(state => ({ user: { ...state.user, mfaEnabled: false } }));
    assert.ok(dom.window.document.body.textContent.includes("Enroll MFA"));
    assert.ok(stackRenders > initialRenders);
    await update(state => ({ user: { ...state.user, mfaEnabled: true } }));
    assert.ok(!dom.window.document.body.textContent.includes("Enroll MFA"));
    await update({ status: "unauthenticated", user: null });
    assert.equal(enabledHistory.at(-1), false, "sign-out disables account announcements");
    assert.equal(new Set(screenLayouts).size, 1, "real gate updates must not replace the screen-layout function");
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
