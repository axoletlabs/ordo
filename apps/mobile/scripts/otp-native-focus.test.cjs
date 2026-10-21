/**
 * Run with: node --test apps/mobile/scripts/otp-native-focus.test.cjs
 *
 * Native focus ownership for the segmented PIN/OTP field. The actual
 * OtpInput.tsx and input-focus-scope.ts run on a jsdom document; React DOM
 * supplies real effects and native focus events, while a small TextInput mock
 * exposes the real handlers (focus, onChangeText, onKeyPress) for direct
 * autofill/arrow/edit attempts.
 *
 * The Save form stays active behind an active folder picker (two live portal
 * siblings). The picker becomes top by publication order, not by reactivating
 * its parent. Closing it must resume the exact OTP group/cell the user left,
 * while raw focus/autofill/arrow/edit calls on the covered group are rejected.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test, after } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

// Install the browser globals before React DOM is required so its input event
// feature detection selects the modern path (not the legacy attachEvent one).
const dom = new JSDOM("<!doctype html><div id='root'></div>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
// TypeScript's CommonJS default-import interop reads `react.default`.
if (!React.default) React.default = React;

const palette = new Proxy({ mode: "dark" }, {
  get(target, key) {
    if (key === "mode") return "dark";
    if (key in target) return target[key];
    return "#123456";
  },
});
const spacing = { 2: 2, 4: 4, 6: 6, 8: 8, 12: 12, 16: 16, 24: 24 };
// Strip React Native-only props so React DOM does not warn on the visual tree.
const DomView = ({ children, style }) => React.createElement("div", { style }, children);
const DomText = ({ children, style }) => React.createElement("span", { style }, children);
const Animated = { View: DomView, Text: DomText, createAnimatedComponent: (type) => type };
const reanimated = {
  default: Animated,
  ...Animated,
  useSharedValue: (value) => ({ value }),
  useAnimatedStyle: () => ({}),
  cancelAnimation() {},
  interpolate: (value) => value,
  interpolateColor: () => "#123456",
  Extrapolation: { CLAMP: "clamp" },
  Easing: {
    out: (fn) => fn, inOut: (fn) => fn, in: (fn) => fn,
    cubic: (x) => x, quad: (x) => x, ease: (x) => x, bezier: () => (x) => x,
  },
  withDelay: (_delay, value) => value,
  withRepeat: (value) => value,
  withSequence: (...values) => values[values.length - 1],
  withSpring: (value) => value,
  withTiming: (value) => value,
};

const TextInput = React.forwardRef(function NativeTextInput(props, ref) {
  const node = React.useRef(null);
  const {
    value, onChangeText, onFocus, onBlur, onKeyPress,
    accessibilityLabel, editable,
  } = props;
  React.useImperativeHandle(ref, () => ({
    focus() { node.current?.focus(); },
    blur() { node.current?.blur(); },
    isFocused() { return dom.window.document.activeElement === node.current; },
    clear() { /* not used by these tests */ },
  }), []);
  React.useLayoutEffect(() => {
    if (node.current) node.current.__props = props;
  });
  return React.createElement("input", {
    ref: node,
    value: value ?? "",
    readOnly: editable === false,
    "aria-label": accessibilityLabel,
    onChange: (event) => onChangeText?.(event.target.value),
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.(),
    onKeyDown: (event) => onKeyPress?.({ nativeEvent: { key: event.key }, preventDefault: () => event.preventDefault() }),
  });
});

const jsxRuntime = require("react/jsx-runtime");
const surfaceContext = React.createContext(null);
const mocks = new Map([
  ["react-native", {
    Platform: { OS: "android", select: (choices) => choices.android ?? choices.default ?? {} },
    Keyboard: { isVisible: () => true },
    StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    TextInput,
    View: DomView,
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  }],
  ["react-native-reanimated", reanimated],
  ["@ordo/shared", { EMAIL_OTP: { LENGTH: 6 }, MFA: { BACKUP_CODE_LENGTH: 8 } }],
  ["./Text", { Text: DomText }],
  ["../../theme/ThemeProvider", { useTheme: () => ({ palette }) }],
  ["../../theme/tokens", {
    fontSize: { "2xl": 24, "3xl": 32, md: 16 },
    radius: { sm: 4 },
    resolveFont: () => undefined,
    spacing,
  }],
  ["../../theme/material-motion", {
    materialMotion: { effects: { fast: {} }, fast: {}, spatial: {} },
    useMaterialMotion: () => ({ reducedMotion: false, fast: {}, spatial: {} }),
  }],
  ["../../theme/state-layer", { alphaTint: () => "rgba(0,0,0,0.38)" }],
  ["../../lib/haptics", { haptics: { selection() {}, success() {}, error() {} } }],
  ["./input-surface", { InputSurfaceContext: surfaceContext }],
  ["./overlay-host", { useOverlayBlocked: () => false }],
  ["../../hooks/use-credential-lock", { useCredentialLock: () => false }],
  ["../../hooks/use-animation-activity", { useAnimationActivity: () => true }],
]);

const moduleCache = new Map();
function resolveLocal(from, name) {
  const base = resolve(dirname(from), name);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    try { readFileSync(candidate); return candidate; } catch {}
  }
  throw new Error(`cannot resolve ${name} from ${from}`);
}
function load(filename) {
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const module = { exports: {} };
  moduleCache.set(filename, module);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const localRequire = (name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (mocks.has(name)) return mocks.get(name);
    if (name.startsWith(".")) return load(resolveLocal(filename, name));
    throw new Error(`unmocked import ${name} from ${filename}`);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

after(() => { dom.window.close(); });

const rootDir = resolve(__dirname, "../src/components/ui");
const scope = load(resolve(rootDir, "input-focus-scope.ts"));
load(resolve(rootDir, "OtpInput.tsx"));
const OtpInput = load(resolve(rootDir, "OtpInput.tsx")).OtpInput;

function Scope({ active, visible, ownerRef, children }) {
  const inputScope = scope.useInputFocusScope(active, true, visible);
  if (ownerRef) ownerRef.current = inputScope.owner;
  return React.createElement(scope.InputFocusScopeContext.Provider, { value: inputScope }, children);
}

function cell(prefix, index) {
  return [...dom.window.document.querySelectorAll("input")].find((node) => {
    const label = node.getAttribute("aria-label") ?? "";
    const match = label.match(/^(.*), .+ (\d+) of (\d+)$/);
    return match && match[1] === prefix && Number(match[2]) === index + 1;
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("top child never owns a PIN cell and close resumes the exact group/cell", async () => {
  const owners = { parent: null, child: null };
  const counts = { primary: 0, backup: 0, background: 0, child: 0 };
  const values = { primary: "1234", backup: "12345678", background: "12", child: "99" };

  function App({ childOpen }) {
    const [primary, setPrimary] = React.useState(values.primary);
    const [backup, setBackup] = React.useState(values.backup);
    const [background, setBackground] = React.useState(values.background);
    const [child, setChild] = React.useState(values.child);
    return React.createElement(React.Fragment, null,
      // Unscoped OTP on the screen behind Save: no scope owner at all.
      React.createElement(OtpInput, {
        label: "Background", value: background, length: 4, autoFocus: false,
        onChange: (next) => { counts.background += 1; setBackground(next); },
      }),
      React.createElement(Scope, { active: true, visible: true, ownerRef: { get current() { return owners.parent; }, set current(v) { owners.parent = v; } } },
        React.createElement(OtpInput, {
          label: "Primary", value: primary, length: 4, purpose: "pin", autoFocus: false,
          onChange: (next) => { counts.primary += 1; setPrimary(next); },
        }),
        React.createElement(OtpInput, {
          label: "Backup", value: backup, length: 8, kind: "backup", autoFocus: false,
          onChange: (next) => { counts.backup += 1; setBackup(next); },
        })),
      React.createElement(Scope, { active: childOpen, visible: childOpen, ownerRef: { get current() { return owners.child; }, set current(v) { owners.child = v; } } },
        React.createElement(OtpInput, {
          label: "Child", value: child, length: 4, autoFocus: false,
          onChange: (next) => { counts.child += 1; setChild(next); },
        })));
  }

  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(App, { childOpen: false })));
    await flush();
    assert.equal(scope.nativeFocusPermitted(owners.parent), true, "Save owns the native focus");
    assert.equal(scope.nativeFocusPermitted(null), false, "the unscoped background OTP is covered");

    // Raw focus and autofill on the unscoped background field are rejected.
    const backgroundCell = cell("Background", 1);
    await act(async () => backgroundCell.focus());
    assert.notEqual(dom.window.document.activeElement, backgroundCell, "background OTP focus is released");
    await act(async () => backgroundCell.__props.onChangeText("9"));
    assert.equal(counts.background, 0, "background OTP autofill/edit is rejected");
    assert.equal(backgroundCell.__props.autoComplete, "off");
    assert.equal(backgroundCell.__props.textContentType, "none");
    assert.equal(backgroundCell.__props.importantForAutofill, "no");

    // Focus the fourth PIN cell, then open the child picker. The parent stays
    // active; only the top portal sibling changes.
    const primaryCell = cell("Primary", 3);
    await act(async () => primaryCell.focus());
    await flush();
    assert.equal(dom.window.document.activeElement, primaryCell);

    await act(async () => root.render(React.createElement(App, { childOpen: true })));
    await flush();
    assert.equal(scope.nativeFocusPermitted(owners.parent), false, "the child is the top owner");
    assert.equal(scope.nativeFocusPermitted(owners.child), true);

    const childCell = cell("Child", 2);
    await act(async () => childCell.focus());
    await flush();
    assert.equal(dom.window.document.activeElement, childCell);

    // Covered PIN/PIN-group raw focus, autofill, arrow, and selection paths.
    await act(async () => primaryCell.focus());
    assert.notEqual(dom.window.document.activeElement, primaryCell, "covered PIN cell refuses raw focus");
    let prevented = false;
    await act(async () => primaryCell.__props.onKeyPress({
      nativeEvent: { key: "ArrowRight" },
      preventDefault() { prevented = true; },
    }));
    await act(async () => primaryCell.__props.onChangeText("9"));
    assert.equal(counts.primary, 0, "covered PIN cell refuses input/autofill edits");
    assert.equal(prevented, false, "covered arrow handling does not run");
    assert.equal(primaryCell.__props.autoComplete, "off");
    assert.equal(primaryCell.__props.textContentType, "none");
    assert.equal(primaryCell.__props.importantForAutofill, "no");
    assert.equal(cell("Primary", 3).__props.editable, true,
      "the native cell remains focusable for the owner's resume; guards enforce ownership");

    // Outside-tap close: only childOpen changes; parent active remains true.
    await act(async () => root.render(React.createElement(App, { childOpen: false })));
    await flush();
    assert.equal(dom.window.document.activeElement, cell("Primary", 3),
      "close resumes the exact PIN cell the user left");

    // A different group/cell is what the next resume restores, not the stale
    // previous cell.
    const backupCell = cell("Backup", 4);
    await act(async () => backupCell.focus());
    await act(async () => root.render(React.createElement(App, { childOpen: true })));
    await flush();
    const childCellAgain = cell("Child", 0);
    await act(async () => childCellAgain.focus());
    await act(async () => root.render(React.createElement(App, { childOpen: false })));
    await flush();
    assert.equal(dom.window.document.activeElement, cell("Backup", 4),
      "the exact group/cell wins; no unrelated primary cell is stolen");

    // Top ownership still permits deliberate edits.
    assert.equal(scope.nativeFocusPermitted(owners.parent), true);
    await act(async () => cell("Backup", 4).focus());
    await flush();
    await act(async () => cell("Backup", 4).__props.onChangeText("9"));
    assert.equal(counts.backup, 1, "the top OTP group still accepts input");
  } finally {
    await act(async () => root.unmount());
  }
});

test("a real scoped owner takes opening autofocus once and never replays it on resume", async () => {
  const owners = { parent: null, child: null };

  function App({ childOpen }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Scope, {
        active: true, visible: true,
        ownerRef: { get current() { return owners.parent; }, set current(v) { owners.parent = v; } },
      }, React.createElement(OtpInput, {
        label: "Pin", value: "12", length: 4, autoFocus: true, onChange: () => {},
      })),
      React.createElement(Scope, {
        active: childOpen, visible: childOpen,
        ownerRef: { get current() { return owners.child; }, set current(v) { owners.child = v; } },
      }, childOpen ? React.createElement(OtpInput, {
        label: "Child", value: "99", length: 4, autoFocus: false, onChange: () => {},
      }) : null));
  }

  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(App, { childOpen: false })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 340)); });
    assert.equal(dom.window.document.activeElement, cell("Pin", 2),
      "the real top scope takes its opening autofocus once");

    await act(async () => cell("Pin", 0).focus());
    await act(async () => root.render(React.createElement(App, { childOpen: true })));
    await act(async () => cell("Child", 0).focus());
    await act(async () => root.render(React.createElement(App, { childOpen: false })));
    await flush();
    assert.equal(dom.window.document.activeElement, cell("Pin", 0),
      "the last real cell resumes");

    // The opening take is already consumed. Even after its 280 ms window, a
    // resume must not replay cell 3 over the user's current cell.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 340)); });
    assert.equal(dom.window.document.activeElement, cell("Pin", 0),
      "opening autofocus never replays on picker close");
  } finally {
    await act(async () => root.unmount());
  }
});

test("a parent reactivation behind a live child does not overtake it", async () => {
  const owners = { parent: null, child: null };
  let primaryChanges = 0;
  let childChanges = 0;

  function App({ parentActive, childOpen }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Scope, {
        active: parentActive, visible: true,
        ownerRef: { get current() { return owners.parent; }, set current(v) { owners.parent = v; } },
      }, React.createElement(OtpInput, {
        label: "Primary", value: "1234", length: 4, autoFocus: false,
        onChange: () => { primaryChanges += 1; },
      })),
      React.createElement(Scope, {
        active: childOpen, visible: childOpen,
        ownerRef: { get current() { return owners.child; }, set current(v) { owners.child = v; } },
      }, React.createElement(OtpInput, {
        label: "Child", value: "99", length: 4, autoFocus: false,
        onChange: () => { childChanges += 1; },
      })));
  }

  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(App, { parentActive: true, childOpen: false })));
    await act(async () => cell("Primary", 3).focus());
    await flush();
    await act(async () => root.render(React.createElement(App, { parentActive: true, childOpen: true })));
    await flush();
    const childCell = cell("Child", 1);
    await act(async () => childCell.focus());
    assert.equal(scope.nativeFocusPermitted(owners.child), true);

    // Interactive/ready churn reactivates the parent while the child remains
    // live. Layer order, not a new activation clock, keeps the child on top.
    await act(async () => root.render(React.createElement(App, { parentActive: false, childOpen: true })));
    await act(async () => root.render(React.createElement(App, { parentActive: true, childOpen: true })));
    await flush();
    assert.equal(scope.nativeFocusPermitted(owners.child), true, "child remains top");
    assert.equal(scope.nativeFocusPermitted(owners.parent), false);
    assert.equal(dom.window.document.activeElement, childCell, "no parent focus is stolen");

    await act(async () => root.render(React.createElement(App, { parentActive: true, childOpen: false })));
    await flush();
    assert.equal(dom.window.document.activeElement, cell("Primary", 3),
      "the exact parent cell resumes only after the child closes");
    assert.equal(primaryChanges, 0);
    assert.equal(childChanges, 0);
  } finally {
    await act(async () => root.unmount());
  }
});
