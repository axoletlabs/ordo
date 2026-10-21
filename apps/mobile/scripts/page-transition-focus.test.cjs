/** Actual PageTransition: retained outgoing routes must release DOM focus, not
 * leave an invisible bookmark/input as the keyboard target behind the reader. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

test("retained routes release their own web focus without blurring another route or native input", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='app'></div><input id='outside'></body></html>");
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let focused = true;
  const listeners = new Set();
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const platform = { OS: "web" };
  const navigation = { getState: () => ({ routes: [{ key: "library" }] }), addListener: () => () => {} };
  const route = { key: "library" };
  const View = React.forwardRef(({ children, testID }, ref) => React.createElement("div", { ref, "data-testid": testID }, children));
  const mocks = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { Platform: platform, View },
    "expo-router": {
      useFocusEffect: callback => {
        const active = React.useSyncExternalStore(subscribe, () => focused);
        React.useEffect(() => active ? callback() : undefined, [active, callback]);
      },
      useNavigation: () => navigation, useRoute: () => route,
    },
    "../../theme/material-motion": { useMaterialMotion: () => ({ reducedMotion: true }) },
    "../../store/settings": { useSettingsStore: selector => selector({ navigationAnimation: "instant" }) },
    "../../hooks/use-animation-activity": { AnimationActivityContext: React.createContext(true) },
    "../../hooks/use-scene-ready": { SceneReadyContext: React.createContext(true) },
    "../../lib/navigation-animation": { screenAnimationDuration: () => 0 },
    "../../lib/idle-work": { scheduleIdleWork: () => { throw new Error("a ready route should not schedule work"); } },
  };
  const filename = process.env.ORDO_PAGE_TRANSITION_SOURCE ?? resolve(__dirname, "../src/components/ui/PageTransition.tsx");
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, mod, mod.exports);
  const root = createRoot(document.getElementById("app"));
  const update = active => React.act(() => { focused = active; listeners.forEach(listener => listener()); });
  try {
    await React.act(() => root.render(React.createElement(mod.exports.PageTransition, null,
      React.createElement("button", { id: "outgoing" }, "Open article"))));
    const outgoing = document.getElementById("outgoing");
    outgoing.focus();
    await update(false);
    assert.equal(outgoing.isConnected, true, "the outgoing screen remains mounted for navigation retention");
    assert.equal(document.activeElement.tagName, "BODY", "hidden route no longer retains keyboard focus");
    await update(true);
    document.getElementById("outside").focus();
    await update(false);
    assert.equal(document.activeElement.id, "outside", "cleanup never blurs the incoming route's deliberate focus");
    platform.OS = "android";
    await update(true);
    const nativeOutgoing = document.getElementById("outgoing");
    nativeOutgoing.focus();
    await update(false);
    assert.ok(document.activeElement === nativeOutgoing, "native focus and IME ownership are not changed by the web route guard");
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
