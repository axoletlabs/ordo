/**
 * Run with: node --test apps/mobile/scripts/auth-connect-opening-focus.test.cjs
 *
 * Opening-focus wiring for the two auth server dialogs.
 *
 * Before: ServerConnectSheet focused its field from a FloatingPanel `onShow`
 * 100 ms timer, and SelfHostFlow's address step scheduled another 100 ms timer.
 * Both put a fixed wall-clock wait between the surface becoming ready and the
 * keyboard target moving.
 *
 * After: native fields delegate to the shared Input focus scope, which waits
 * for the panel to measure and then takes focus on one animation frame.
 * ServerConnectSheet also gets that opening focus from the web overlay focus
 * session. SelfHostFlow's address step is not a new overlay session on web, so
 * it keeps one explicit web-only frame (cancelled on close); native delegates
 * entirely. Fixed focus timers: 2 -> 0. Opening frames: 0 -> 1 where the
 * platform owns a local take.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test, after } = require("node:test");
const ts = require("typescript");
const React = require("../../../node_modules/react");
const { createRoot } = require("../../../node_modules/react-dom/client");
const { JSDOM } = require("../../../node_modules/jsdom");

if (!React.default) React.default = React;
const jsxRuntime = require("react/jsx-runtime");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

let platformOS = "android";
let frameId = 0;
const frames = new Map();
globalThis.requestAnimationFrame = (callback) => {
  const id = ++frameId;
  frames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };

function runFrames() {
  let guard = 0;
  while (frames.size) {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
    assert.ok(++guard < 10, "frame loop did not settle");
  }
}

// --------------------------------------------------------------- leaf mocks
const inputProps = [];
let latestInput = null;
const focusCalls = [];
const Input = React.forwardRef(function MockInput(props, ref) {
  latestInput = props;
  inputProps.push(props);
  React.useImperativeHandle(ref, () => ({
    focus() { focusCalls.push(props); },
    blur() {},
    isFocused() { return false; },
  }));
  return React.createElement("div", { "data-field": props.label ?? "field" });
});

const floatingPanels = [];
function FloatingPanel(props) {
  floatingPanels.push(props);
  return props.visible
    ? React.createElement("div", { "data-panel": "true" }, props.children)
    : null;
}

const panelActions = [];
function PanelActions(props) {
  panelActions.push(props);
  return React.createElement("div", { "data-actions": props.confirmLabel });
}

let checkLine = null;
function CheckLine(props) {
  checkLine = props;
  return React.createElement("div", { "data-check": props.label });
}

function Passthrough({ children }) {
  return React.createElement("div", null, children);
}

const modules = new Map([
  ["react-native", {
    Platform: {
      get OS() { return platformOS; },
      select: (choices) => choices[platformOS] ?? choices.default ?? {},
    },
    StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    View: Passthrough,
    Keyboard: { dismiss() {} },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  }],
  ["@ordo/shared", { APP_NAME: "ordo" }],
  ["../ui/FloatingPanel", { FloatingPanel }],
  ["../ui/ThemedScrollView", { ThemedScrollView: Passthrough }],
  ["../ui/PanelHeader", { PanelHeader: () => null }],
  ["../ui/Input", { Input }],
  ["../ui/SheetActionRow", { PanelActions }],
  ["../ui/CheckLine", { CheckLine }],
  ["../ui/ConfirmDialog", { ConfirmDialog: () => null }],
  ["../ui/Text", { Text: Passthrough }],
  ["../../store/settings", {
    useSettingsStore: (selector) => selector({
      serverUrl: "https://cloud.example",
      setServerUrl: async () => {},
    }),
  }],
  ["../../store/auth", {
    useAuthStore: (selector) => selector({ status: "authenticated" }),
  }],
  ["../../hooks/use-server-probe", {
    useServerProbe: (url, currentUrl, active) => {
      const normalized = /^https?:\/\/[^/]+$/.test(url) ? url : null;
      return {
        normalized,
        canChange: Boolean(active && normalized && normalized !== currentUrl),
        probeCopy: { error: undefined, helper: undefined },
        probing: false,
        up: false,
        setUp() {},
        setProbeDetail() {},
        setProbeInfo() {},
      };
    },
  }],
  ["../../hooks/use-commit-server-switch", {
    useCommitServerSwitch: () => ({ commit: async () => true, busy: false }),
  }],
  ["../../lib/hosting", { isCloudServerUrl: () => false }],
  ["../../lib/server-probe", {
    probeServer: async () => ({ status: "up", url: "https://new.example" }),
  }],
  ["../../lib/haptics", { haptics: { selection() {}, success() {}, error() {}, light() {} } }],
  ["../../theme/tokens", { spacing: { 2: 2, 4: 4, 6: 6, 8: 8, 12: 12, 16: 16, 24: 24 } }],
  ["../../theme/type-metrics", { FOOTNOTE_LINE_BOX: 18 }],
]);

const sourceRoot = process.env.ORDO_AUTH_SOURCE_ROOT ?? resolve(__dirname, "../src");
const moduleCache = new Map();
function load(filename) {
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  moduleCache.set(filename, module);
  const localRequire = (name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (modules.has(name)) return modules.get(name);
    throw new Error(`Unmocked import ${name} from ${filename}`);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

function mount(Component, props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const element = (next) => React.createElement(Component, next);
  act(() => root.render(element(props)));
  return {
    rerender(next) { act(() => root.render(element(next))); },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function walkSource(filename, visit) {
  const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"),
    ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const step = (node) => {
    visit(node, source);
    ts.forEachChild(node, step);
  };
  step(source);
}

/** Fixed focus timers are exactly the opening lag this change removes. */
function fixedFocusTimers(filename) {
  const hits = [];
  walkSource(filename, (node, source) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    if (node.expression.text !== "setTimeout" && node.expression.text !== "setInterval") return;
    const callback = node.arguments[0];
    if (callback && callback.getText(source).includes(".focus(")) hits.push(callback.getText(source));
  });
  return hits;
}

const files = {
  otp: resolve(sourceRoot, "components/ui/OtpInput.tsx"),
  server: resolve(sourceRoot, "components/auth/ServerConnectSheet.tsx"),
  selfHost: resolve(sourceRoot, "components/settings/SelfHostFlow.tsx"),
};

after(() => dom.window.close());

test("auth opening focus never uses a fixed focus timer", () => {
  for (const [name, filename] of Object.entries(files)) {
    assert.deepEqual(fixedFocusTimers(filename), [], `${name} has no delayed focus callback`);
  }
});

test("ServerConnectSheet asks for its field through the shared Input autoFocus path", () => {
  platformOS = "android";
  inputProps.length = 0;
  latestInput = null;
  floatingPanels.length = 0;
  const Sheet = load(files.server).ServerConnectSheet;
  const view = mount(Sheet, { visible: true, onDismiss() {} });
  try {
    assert.equal(latestInput?.autoFocus, true, "the field carries the opening intent");
    assert.equal(floatingPanels.at(-1)?.onShow, undefined, "the panel no longer owns a timer");
    assert.equal(focusCalls.length, 0, "focus is not grabbed from the component or a timer");
    runFrames();
    assert.equal(focusCalls.length, 0,
      "native focus belongs to the real Input scope, not this wrapper");
  } finally {
    view.unmount();
  }
});

test("SelfHostFlow web address entry focuses on one frame, not after 100 ms", () => {
  platformOS = "web";
  inputProps.length = 0;
  latestInput = null;
  focusCalls.length = 0;
  const Flow = load(files.selfHost).SelfHostFlow;
  const view = mount(Flow, { visible: true, onDismiss() {} });
  try {
    act(() => checkLine.onPress());
    act(() => panelActions.at(-1).onConfirm());
    assert.equal(latestInput?.autoFocus, true, "the native/shared intent is present");
    assert.equal(frames.size, 1, "one web frame is scheduled for the step swap");
    assert.equal(focusCalls.length, 0, "nothing focuses before the frame");

    runFrames();
    assert.equal(focusCalls.length, 1, "the address field focuses on the first frame");
  } finally {
    view.unmount();
  }
});

test("closing before the web frame cancels the address take", () => {
  platformOS = "web";
  focusCalls.length = 0;
  const Flow = load(files.selfHost).SelfHostFlow;
  const view = mount(Flow, { visible: true, onDismiss() {} });
  try {
    act(() => checkLine.onPress());
    act(() => panelActions.at(-1).onConfirm());
    assert.equal(frames.size, 1);
    view.rerender({ visible: false, onDismiss() {} });
    assert.equal(frames.size, 0, "the closing commit cancels the frame");
    runFrames();
    assert.equal(focusCalls.length, 0, "a closed flow never focuses");
  } finally {
    view.unmount();
  }
});

test("SelfHostFlow native address entry leaves focus to the Input scope", () => {
  platformOS = "android";
  latestInput = null;
  focusCalls.length = 0;
  const Flow = load(files.selfHost).SelfHostFlow;
  const view = mount(Flow, { visible: true, onDismiss() {} });
  try {
    act(() => checkLine.onPress());
    act(() => panelActions.at(-1).onConfirm());
    assert.equal(latestInput?.autoFocus, true);
    assert.equal(frames.size, 0, "native schedules no local frame or timer");
    runFrames();
    assert.equal(focusCalls.length, 0, "the real Input scope owns the opening take");
  } finally {
    view.unmount();
  }
});
