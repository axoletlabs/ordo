/** Android native TextInput identity and focus ownership for the shared Input.
 * Run with: node --test apps/mobile/scripts/input-native-focus.test.cjs
 *
 * The regression: Input's Android uncontrolled mode remounted its TextInput
 * (`key={android-field-N}`) whenever an external value arrived while blurred.
 * A picker session blurs the save dialog's link field, so a late IME/clipboard
 * value changed the key, mounted a fresh native EditText and replayed
 * autoFocus, which pulled focus and the IME out of the picker. onBlur also
 * rewrote `lastAppliedValue` from its (possibly stale) render closure.
 *
 * This harness executes the real Input.tsx and native-input-edit.ts against a
 * minimal hooks/JSX runtime. A TextInput host keeps identity per path + key,
 * applies autoFocus only when a native instance is created (matching
 * ReactEditText.onAttachedToWindow), and records native setNativeProps writes.
 * It also models the native focus/IME state used by scoped overlay sessions:
 * a new session may take focus once, same-session picker resume may not, and a
 * covering overlay layer cancels pending takes without blurring anything.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const sourceRoot = process.env.ORDO_INPUT_SOURCE_ROOT ?? resolve(__dirname, "../src");

function transpile(filename) {
  return ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function depsEqual(a, b) {
  return a === b || (!!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
}

/** Minimal React with per-path hook slots, converging state, and commit-time effects. */
function reactHarness() {
  const hookFrames = new Map();
  const scheduledFrames = new Map();
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    scheduledFrames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => { scheduledFrames.delete(id); };
  const layoutEffects = [];
  const passiveEffects = [];
  let activeFrame = null;
  let activePath = "";
  let currentInput = null;
  let commits = 0;
  let changed = false;

  function frameFor(path, type) {
    let frame = hookFrames.get(path);
    if (!frame || frame.type !== type) {
      frame = { type, slots: [], cursor: 0 };
      hookFrames.set(path, frame);
    }
    return frame;
  }

  function state(initial) {
    const index = activeFrame.cursor++;
    const frame = activeFrame;
    if (!(index in frame.slots)) frame.slots[index] = typeof initial === "function" ? initial() : initial;
    return [frame.slots[index], (next) => {
      const value = typeof next === "function" ? next(frame.slots[index]) : next;
      if (!Object.is(value, frame.slots[index])) { frame.slots[index] = value; changed = true; }
    }];
  }

  function effect(queue) {
    return (callback, deps) => {
      const index = activeFrame.cursor++;
      const frame = activeFrame;
      const previous = frame.slots[index];
      if (previous && deps !== undefined && depsEqual(deps, previous.deps)) return;
      const record = { deps, cleanup: previous?.cleanup };
      frame.slots[index] = record;
      queue.push(() => {
        record.cleanup?.();
        const cleanup = callback();
        record.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    };
  }

  const react = {
    useState: state,
    useRef(initial) {
      const index = activeFrame.cursor++;
      return activeFrame.slots[index] ??= { current: initial };
    },
    useMemo(factory) { activeFrame.cursor++; return factory(); },
    useCallback(callback) { activeFrame.cursor++; return callback; },
    useEffect: effect(passiveEffects),
    useLayoutEffect: effect(layoutEffects),
    useId: () => "input-test-id",
    useContext: (context) => context?._current,
    createContext: (initial) => {
      const context = { _current: initial, Provider: null, Consumer: null };
      context.Provider = { __context: context };
      context.Consumer = { __context: context };
      return context;
    },
    forwardRef: (render) => (props) => render(props, props.ref ?? null),
    memo: (component) => component,
    isValidElement: (element) => !!element && typeof element === "object" && "type" in element && "props" in element,
    cloneElement: (element, props, ...children) => ({
      ...element,
      props: { ...element.props, ...props, ...(children.length ? { children } : {}) },
    }),
    Children: {
      toArray(children) {
        if (children == null) return [];
        return (Array.isArray(children) ? children : [children]).flat(Infinity)
          .filter((child) => child != null && child !== false && child !== true);
      },
    },
  };
  react.default = react;

  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
    jsxs: (type, props, key) => ({ type, props: props ?? {}, key }),
    Fragment: "Fragment",
  };

  const palette = Object.fromEntries([
    "surface", "surfaceContainerHigh", "surfaceContainerHighest", "onSurface", "onSurfaceVariant",
    "primary", "error", "outline", "mode",
  ].map((role) => [role, role === "mode" ? "dark" : "#123456"]));
  const spacing = { 2: 2, 4: 4, 6: 6, 8: 8, 12: 12, 16: 16, 24: 24 };
  const tokens = {
    spacing,
    radius: { xs: 2, sm: 4, lg: 8, full: 999 },
    fontSize: { md: 16 },
    resolveFont: () => undefined,
  };
  const context = { _current: undefined };
  const Animated = { createAnimatedComponent: (type) => type, View: "AnimatedView" };
  const reanimated = {
    default: Animated,
    createAnimatedComponent: Animated.createAnimatedComponent,
    useSharedValue: (value) => ({ value }),
    useAnimatedStyle: () => ({}),
    withTiming: (value) => value,
  };
  let keyboardVisible = true;
  let nativeFocusedInput = null;
  let overlayBlocked = false;
  let appState = "active";
  const appStateListeners = new Set();
  const TextInput = function TextInputHost() {};
  TextInput.State = {
    currentlyFocusedInput: () => nativeFocusedInput,
    blurTextInput: (node) => {
      if (nativeFocusedInput === node) {
        nativeFocusedInput = null;
        keyboardVisible = false;
      }
      node?.blur?.();
    },
  };
  const reactNative = {
    AppState: {
      get currentState() { return appState; },
      addEventListener(type, listener) {
        if (type !== "change") return { remove() {} };
        appStateListeners.add(listener);
        return { remove() { appStateListeners.delete(listener); } };
      },
    },
    Platform: {
      OS: "android",
      select: (choices) => choices.android ?? choices.default ?? {},
    },
    Keyboard: { isVisible: () => keyboardVisible },
    StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    TextInput,
    View: "View",
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  };

  const moduleCache = new Map();
  let focusScopeContext = null;
  function load(filename) {
    if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
    const output = transpile(filename);
    const module = { exports: {} };
    moduleCache.set(filename, module);
    const localRequire = (name) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "react-native") return reactNative;
      if (name === "react-native-reanimated") return reanimated;
      if (name === "./StateLayer") return { StateLayer: "StateLayer" };
      if (name === "./Text") return { Text: "Text" };
      if (name === "./MaterialIcon") return { MaterialIcon: "MaterialIcon" };
      if (name === "../../theme/ThemeProvider") return { useTheme: () => ({ palette }) };
      if (name === "../../theme/tokens") return tokens;
      if (name === "../../lib/web-input-caret") return { caretAfterKey: () => 0, shouldCorrectWebCaret: () => false };
      if (name === "../../theme/material-motion") return { useMaterialMotion: () => ({ reducedMotion: false }) };
      if (name === "./input-surface") return { InputSurfaceContext: context };
      if (name === "./input-focus-scope") return load(resolve(sourceRoot, "components/ui/input-focus-scope.ts"));
      if (name === "./overlay-host") return { useOverlayBlocked: () => overlayBlocked };
      if (name === "./panel-title") return { PanelTitleContext: context };
      if (name === "../../theme/state-layer") return { alphaTint: () => "rgba(0,0,0,0.38)" };
      if (name === "../../lib/focus-text-input") return load(resolve(sourceRoot, "lib/focus-text-input.ts"));
      if (name === "../../lib/native-input-edit") return load(resolve(sourceRoot, "lib/native-input-edit.ts"));
      if (name === "../../lib/input-privacy") return load(resolve(sourceRoot, "lib/input-privacy.ts"));
      throw new Error(`Unexpected import ${name} from ${filename}`);
    };
    new Function("require", "module", "exports", output)(localRequire, module, module.exports);
    return module.exports;
  }

  // Each native instance models one mounted ReactEditText. autoFocus only
  // requests focus while attaching to a window, never when the prop updates.
  let nativeId = 0;
  let mounts = 0;
  let autoFocusRequests = 0;
  let focusCalls = 0;
  let blurCalls = 0;
  const eventLog = [];
  const focusRequests = [];
  const hosts = new Map();
  function renderNativeInput(path, key, props) {
    let host = hosts.get(path);
    if (!host || host.key !== key) {
      const instance = {
        id: ++nativeId,
        text: typeof props.defaultValue === "string" ? props.defaultValue
          : typeof props.value === "string" ? props.value : "",
        selection: { start: 0, end: 0 },
        focused: false,
        setNativePropsCalls: [],
        controlledWrites: 0,
        props,
      };
      instance.focus = () => {
        focusCalls++;
        eventLog.push("focus");
        instance.focused = true;
        nativeFocusedInput = instance;
        keyboardVisible = true;
        instance.props.onFocus({ nativeEvent: {} });
      };
      instance.blur = () => {
        blurCalls++;
        eventLog.push("blur");
        instance.focused = false;
        if (nativeFocusedInput === instance) nativeFocusedInput = null;
        keyboardVisible = false;
        instance.props.onBlur({ nativeEvent: {} });
      };
      instance.isFocused = () => nativeFocusedInput === instance;
      host = { key, instance };
      hosts.set(path, host);
      mounts++;
      if (props.autoFocus) {
        autoFocusRequests++;
        focusRequests.push(instance.id);
        eventLog.push("native-autofocus");
        instance.focused = true;
        nativeFocusedInput = instance;
        keyboardVisible = true;
      }
      props.ref?.(instance);
    } else {
      props.ref?.(host.instance);
    }
    const instance = host.instance;
    instance.props = props;
    instance.setNativeProps = (native) => {
      instance.setNativePropsCalls.push(native);
      if (typeof native.text === "string") instance.text = native.text;
      if (native.selection) instance.selection = { ...native.selection };
    };
    // Controlled fields (including secure/autofill ones) receive the prop
    // value through React Native's text synchronization.
    if (typeof props.value === "string" && props.value !== instance.text) {
      instance.text = props.value;
      instance.controlledWrites++;
    }
    currentInput = instance;
    return { type: "TextInput", props, instance };
  }

  function renderNode(node, path) {
    if (node == null || node === false || node === true) return node;
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}/${index}`));
    if (typeof node !== "object" || !("type" in node)) return node;
    const key = node.key ?? null;
    const props = node.props ?? {};
    if (node.type && typeof node.type === "object" && node.type.__context) {
      const context = node.type.__context;
      const previous = context._current;
      context._current = props.value;
      try { return renderNode(props.children, `${path}/context`); } finally { context._current = previous; }
    }
    if (node.type === reactNative.TextInput) return renderNativeInput(path, key, props);
    if (typeof node.type === "function") {
      const frame = frameFor(`${path}:${String(key)}`, node.type);
      const previousFrame = activeFrame;
      const previousPath = activePath;
      activeFrame = frame;
      activePath = `${path}:${String(key)}`;
      frame.cursor = 0;
      let output;
      try { output = node.type(props); } finally { activeFrame = previousFrame; activePath = previousPath; }
      return renderNode(output, `${path}()`);
    }
    if (typeof props.children === "undefined") return { ...node, key };
    const children = react.Children.toArray(props.children)
      .map((child, index) => renderNode(child, `${path}/${index}`));
    return { ...node, key, props: { ...props, children: Array.isArray(children) && children.length === 1 ? children[0] : children } };
  }

  let lastFactory = null;
  function render(factory) {
    lastFactory = factory;
    let tree;
    do {
      changed = false;
      layoutEffects.length = 0;
      passiveEffects.length = 0;
      tree = renderNode(factory(), "root");
      while (layoutEffects.length) layoutEffects.shift()();
      while (passiveEffects.length) passiveEffects.shift()();
      assert.ok(++commits < 40, "commit loop did not settle");
    } while (changed);
    return tree;
  }
  function runFrames() {
    let guard = 0;
    while (scheduledFrames.size) {
      const callbacks = [...scheduledFrames.values()];
      scheduledFrames.clear();
      callbacks.forEach((callback) => callback());
      assert.ok(++guard < 10, "frame loop did not settle");
    }
    // focus() raises onFocus, which updates Input's focused state.
    if (changed && lastFactory) render(lastFactory);
  }

  return {
    react,
    loadInput() {
      const input = load(resolve(sourceRoot, "components/ui/Input.tsx")).Input;
      focusScopeContext = load(resolve(sourceRoot, "components/ui/input-focus-scope.ts")).InputFocusScopeContext;
      return input;
    },
    render,
    runFrames,
    get focusScopeContext() { return focusScopeContext; },
    get currentInput() { return currentInput; },
    get mounts() { return mounts; },
    get autoFocusRequests() { return autoFocusRequests; },
    get focusCalls() { return focusCalls; },
    get blurCalls() { return blurCalls; },
    get eventLog() { return eventLog; },
    get keyboardVisible() { return keyboardVisible; },
    setKeyboardVisible(value) { keyboardVisible = value; },
    get nativeFocusedInput() { return nativeFocusedInput; },
    setNativeFocusedInput(value) { nativeFocusedInput = value; },
    setOverlayBlocked(value) { overlayBlocked = value; },
    setAppState(value) {
      appState = value;
      for (const listener of [...appStateListeners]) listener(value);
    },
    get appStateListenerCount() { return appStateListeners.size; },
    get pendingFrames() { return scheduledFrames.size; },
    get focusRequests() { return focusRequests; },
  };
}

function createInputHost(initialProps, initialScope = null, initialFocus = null, initialBlocked = false, initialAppState = "active") {
  const h = reactHarness();
  const Input = h.loadInput();
  let focusScope = initialScope;
  const state = {
    value: initialProps.value,
    autoFocus: !!initialProps.autoFocus,
  };
  const baseProps = {
    ...initialProps,
    value: undefined,
    autoFocus: undefined,
    onChangeText: (text) => { state.value = text; },
  };
  const host = {
    h,
    first: null,
    render() {
      h.render(() => ({
        type: h.focusScopeContext.Provider,
        props: {
          value: focusScope,
          children: { type: Input, props: { ...baseProps, value: state.value, autoFocus: state.autoFocus } },
        },
      }));
      return h.currentInput;
    },
    input() { return h.currentInput; },
    setValue(value) { state.value = value; return host.render(); },
    setAutoFocus(autoFocus) { state.autoFocus = autoFocus; return host.render(); },
    setScope(scope) { focusScope = scope; return host.render(); },
    setOverlayBlocked(blocked) { h.setOverlayBlocked(blocked); return host.render(); },
    focus() {
      const input = host.input();
      input.focused = true;
      host.h.setNativeFocusedInput(input);
      host.h.setKeyboardVisible(true);
      input.props.onFocus({ nativeEvent: {} });
      return host.render();
    },
    blur() {
      const input = host.input();
      input.focused = false;
      host.h.setNativeFocusedInput(null);
      host.h.setKeyboardVisible(false);
      input.props.onBlur({ nativeEvent: {} });
    },
    changeText(text) {
      const input = host.input();
      input.text = text;
      input.selection = { start: text.length, end: text.length };
      input.props.onChangeText(text);
    },
  };
  h.setNativeFocusedInput(initialFocus);
  h.setOverlayBlocked(initialBlocked);
  h.setAppState(initialAppState);
  host.first = host.render();
  return host;
}

test("Android Input keeps one native node when a batched keystroke is followed by blur", () => {
  const host = createInputHost({ label: "Link", value: "https://old.example", autoFocus: true });
  const first = host.input();
  assert.equal(first.id, 1);
  assert.equal(host.h.mounts, 1, "the field mounts once");
  assert.equal(host.h.autoFocusRequests, 1, "mount autoFocus requests focus once");

  host.focus();
  // Native text changes and the parent state update is batched, then the field
  // blurs (tapping Folder/Tags) before React commits the new value.
  host.changeText("https://old.example/new");
  host.blur();
  host.render();

  assert.equal(host.input(), first, "late IME text + blur keeps the same native TextInput");
  assert.equal(host.h.mounts, 1, "no replacement native EditText is mounted");
  assert.equal(host.h.autoFocusRequests, 1, "autoFocus is not replayed");
  assert.equal(host.input().text, "https://old.example/new", "the committed value is retained");
  assert.deepEqual(host.input().setNativePropsCalls, [], "the parent echo is not written over native text");
});

test("Android Input applies an external blurred edit imperatively without remount or focus", () => {
  const host = createInputHost({ label: "Link", value: "typed", autoFocus: true });
  const first = host.input();
  host.focus();
  host.blur();

  const next = host.setValue("");
  assert.equal(next, first, "a cleared/reset draft keeps the same native TextInput");
  assert.equal(host.h.mounts, 1);
  assert.equal(host.h.autoFocusRequests, 1, "the blurred field never takes focus back");
  assert.equal(next.text, "", "the native field shows the external value");
  assert.deepEqual(next.setNativePropsCalls, [
    { text: "", selection: { start: 0, end: 0 } },
  ], "the external edit is written into native text once");
});

test("Android Input writes focused external edits through the same native node", () => {
  const host = createInputHost({ label: "Link", value: "typed", autoFocus: true });
  const first = host.input();
  host.focus();
  const pasted = "https://pasted.example";
  const input = host.setValue(pasted);
  assert.equal(input, first, "clipboard paste keeps the native TextInput");
  assert.equal(host.h.mounts, 1);
  assert.equal(host.h.autoFocusRequests, 1);
  assert.deepEqual(input.setNativePropsCalls, [
    { text: pasted, selection: { start: pasted.length, end: pasted.length } },
  ], "the focused replacement places the caret at the end");
});

test("Android Input never writes a parent echo of typed text back into native", () => {
  const host = createInputHost({ label: "Link", value: "a", autoFocus: true });
  host.focus();
  const input = host.input();
  input.selection = { start: 1, end: 1 };
  host.changeText("ab");
  const selection = { ...input.selection };
  host.render();
  assert.equal(host.input(), input);
  assert.equal(input.text, "ab");
  assert.deepEqual(input.selection, selection, "typing keeps the native caret");
  assert.deepEqual(input.setNativePropsCalls, [], "the controlled echo performs no native write");
});

test("Android Input does not replay autoFocus when the prop flips after mount", () => {
  const host = createInputHost({ label: "Link", value: "old", autoFocus: false });
  const first = host.input();
  host.setAutoFocus(true);
  host.setValue("new");
  assert.equal(host.input(), first, "the native TextInput keeps its identity");
  assert.equal(host.h.mounts, 1);
  assert.equal(host.h.autoFocusRequests, 0, "autoFocus only attaches with the first native mount");
});

test("secure fields stay controlled and never take the uncontrolled path", () => {
  const host = createInputHost({ label: "Password", value: "secret", secureTextEntry: true, autoFocus: true });
  const first = host.input();
  assert.equal(first.props.value, "secret", "secure fields keep the controlled value prop");
  assert.equal(first.props.defaultValue, undefined, "secure fields do not use a launch defaultValue");
  host.focus();
  host.blur();
  const input = host.setValue("new secret");
  assert.equal(input, first);
  assert.equal(host.h.mounts, 1);
  assert.equal(host.h.autoFocusRequests, 1);
  assert.equal(input.text, "new secret", "React Native's controlled synchronization receives the value");
  assert.equal(input.controlledWrites, 1);
  assert.deepEqual(input.setNativePropsCalls, [], "secure edits are not written through the uncontrolled path");
});

test("scoped native autoFocus waits for panel readiness and the opening keyboard dismissal", () => {
  const host = createInputHost({ label: "Link", value: "", autoFocus: true }, { active: true, ready: false, session: 0 });
  const first = host.input();
  assert.equal(first.props.autoFocus, false, "the native mount must not take focus before the panel measures");
  assert.equal(host.h.autoFocusRequests, 0);
  assert.equal(host.h.focusCalls, 0);
  assert.equal(host.h.pendingFrames, 0, "a not-ready owner schedules nothing yet");
  assert.equal(host.h.appStateListenerCount, 1, "the pending initial intent watches app state while measuring");

  // useOverlayPresence's opening layout dismisses any previous IME before the
  // entrance starts. The input's frame must run after that dismissal.
  host.h.eventLog.push("panel-layout-dismiss");
  host.setScope({ active: true, ready: true, session: 0 });
  assert.equal(host.h.pendingFrames, 1, "ready schedules one frame");
  assert.equal(host.h.focusCalls, 0, "focus is deferred out of the opening layout");
  // The opening dismissal already cleared the IME and no field is focused.
  host.h.setKeyboardVisible(false);
  host.h.runFrames();

  assert.equal(host.h.focusCalls, 1, "the ready panel focuses its field exactly once");
  assert.equal(host.h.blurCalls, 0, "an unfocused target needs no extra blur");
  assert.equal(host.h.appStateListenerCount, 0, "consuming the take disposes the observer");
  assert.deepEqual(host.h.eventLog, ["panel-layout-dismiss", "focus"]);
  assert.equal(host.input(), first, "the deferred focus uses the same native TextInput");
  assert.equal(host.h.mounts, 1);
  assert.equal(host.h.autoFocusRequests, 0, "native mount autoFocus stays suppressed");
});

test("scoped native autoFocus cancels a pending take when the owner closes quickly", () => {
  const host = createInputHost({ label: "Link", value: "", autoFocus: true }, { active: true, ready: true, session: 0 });
  const first = host.input();
  assert.equal(host.h.pendingFrames, 1);
  assert.equal(host.h.focusCalls, 0);

  host.setScope({ active: false, ready: true, session: 0 });
  assert.equal(host.h.pendingFrames, 0, "closing/obscuring cancels the pending frame");
  host.setScope({ active: true, ready: true, session: 0 });
  host.h.runFrames();

  assert.equal(host.h.focusCalls, 0, "reactivation after the picker must not replay autoFocus");
  assert.equal(host.h.blurCalls, 0, "panel suspension never blurs the native field");
  assert.equal(host.input(), first);
  assert.equal(host.h.mounts, 1);
});

test("a scope that is initially inactive never takes focus when it resumes", () => {
  const host = createInputHost({ label: "Link", value: "", autoFocus: true }, { active: false, ready: false, session: 0 });
  assert.equal(host.h.autoFocusRequests, 0);
  assert.equal(host.h.focusCalls, 0);

  host.setScope({ active: true, ready: true, session: 0 });
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0, "an inactive initial owner has no autofocus intent");
  assert.equal(host.h.pendingFrames, 0);
  assert.equal(host.h.appStateListenerCount, 0, "an inactive owner installs no app-state observer");
});

test("manual focus cancels a scheduled scoped autofocus take", () => {
  const host = createInputHost({ label: "Link", value: "", autoFocus: true }, { active: true, ready: true, session: 0 });
  assert.equal(host.h.pendingFrames, 1);

  host.focus();
  assert.equal(host.h.pendingFrames, 0, "the user already owns focus");
  assert.equal(host.h.appStateListenerCount, 0, "cancelling removes the pending-only listener");
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0, "the pending programmatic take is cancelled");
  assert.equal(host.input().focused, true, "the manual focus remains in place");
});

test("a suspending and resuming scoped owner focuses at most once", () => {
  const host = createInputHost({ label: "Link", value: "", autoFocus: true }, { active: true, ready: true, session: 0 });
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 1);

  host.setScope({ active: false, ready: true, session: 0 });
  host.setScope({ active: true, ready: true, session: 0 });
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 1, "returning from a child picker does not replay the take");
  assert.equal(host.h.blurCalls, 0);
});

test("rising autoFocus on an already mounted scoped field does not take focus", () => {
  const host = createInputHost({ label: "Link", value: "old", autoFocus: false }, { active: true, ready: true, session: 0 });
  const first = host.input();
  host.setAutoFocus(true);
  host.setValue("new");
  host.h.runFrames();
  assert.equal(host.input(), first);
  assert.equal(host.h.focusCalls, 0, "only a fresh Input mount can request scoped autofocus");
  assert.equal(host.h.mounts, 1);
  assert.equal(host.h.appStateListenerCount, 0, "a field without autofocus intent never observes app state");
});

test("unscoped native fields keep their existing mount autoFocus behavior", () => {
  const host = createInputHost({ label: "Email", value: "", autoFocus: true });
  assert.equal(host.input().props.autoFocus, true);
  assert.equal(host.h.autoFocusRequests, 1);
  assert.equal(host.h.focusCalls, 0, "unscoped focus is still the native mount request");
  assert.equal(host.h.pendingFrames, 0);
  assert.equal(host.h.appStateListenerCount, 0, "unscoped fields never observe app state");
});

test("readonly and disabled fields keep one node and still show external values", () => {
  for (const [name, locked] of [["readOnly", { readOnly: true }], ["disabled", { disabled: true }]]) {
    const host = createInputHost({ label: "Link", value: "a", ...locked });
    const first = host.input();
    assert.equal(first.props.editable, false, `${name} stays non-editable`);
    assert.equal(first.props.onChangeText, undefined, `${name} accepts no text edits`);
    const input = host.setValue("b");
    assert.equal(input, first, `${name} keeps its native TextInput`);
    assert.equal(input.text, "b", `${name} receives the parent value`);
    assert.equal(host.h.mounts, 1);
  }
});

test("a retained scoped field focuses once for each new session", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: true, session: 1 },
  );
  const first = host.input();
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 1);

  // Quick close/reopen inside the retained exit: same native node, new session.
  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  assert.equal(host.h.pendingFrames, 1, "the new session schedules its own take");
  host.h.runFrames();

  assert.equal(host.h.focusCalls, 2, "the new session takes focus once");
  assert.equal(host.h.blurCalls, 0, "a visible IME on the same field is not disturbed");
  assert.equal(host.h.appStateListenerCount, 0, "the pending-only app-state listener is removed");
  assert.equal(host.input(), first, "the retained native TextInput keeps its identity");
  assert.equal(host.h.mounts, 1);

  // Picker suspension/resume inside session 2 is not a new session.
  host.setScope({ active: false, ready: true, session: 2 });
  host.setScope({ active: true, ready: true, session: 2 });
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 2, "same-session resume never replays the take");
});

test("a new session reopens the IME on a retained Android field still marked focused", () => {
  const host = createInputHost(
    { label: "Find a folder", value: "", autoFocus: true },
    { active: true, ready: true, session: 1 },
  );
  const first = host.input();
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 1);

  // Android Back hides the IME but RN TextInputState still reports this node.
  host.h.setKeyboardVisible(false);
  assert.equal(first.isFocused(), true);

  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  host.h.runFrames();

  assert.equal(host.h.focusCalls, 2);
  assert.equal(host.h.blurCalls, 1, "only the retained target is blurred to reopen the IME");
  assert.equal(host.h.keyboardVisible, true, "the keyboard is visible again");
  assert.equal(host.input(), first);
  assert.equal(host.h.mounts, 1);
});

test("a deliberate focus on another field before the new-session take wins", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: true, session: 1 },
  );
  const first = host.input();
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 1);

  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  const other = { id: "other-field" };
  host.h.setNativeFocusedInput(other);
  host.h.runFrames();

  assert.equal(host.h.focusCalls, 1, "the delayed take is skipped");
  assert.equal(host.h.blurCalls, 0, "the deliberately focused field is never blurred");
  assert.equal(host.h.nativeFocusedInput, other);
  assert.equal(host.input(), first);
});

test("a stale background focus is replaced, not treated as a deliberate choice", () => {
  const background = { id: "background-field" };
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: true, session: 1 },
    background,
  );
  const first = host.input();
  host.h.runFrames();

  assert.equal(host.h.focusCalls, 1, "the scoped take still runs over a stale owner");
  assert.equal(host.h.blurCalls, 0, "the background field is not explicitly blurred");
  assert.equal(host.h.nativeFocusedInput, first);
  assert.equal(host.h.mounts, 1);
});

test("native scoped autofocus cancels while blocked and never resumes", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: false, session: 1 },
  );
  host.setScope({ active: true, ready: true, session: 1 });
  assert.equal(host.h.pendingFrames, 1);

  host.setOverlayBlocked(true);
  assert.equal(host.h.pendingFrames, 0, "a covering overlay cancels the pending take");
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0);
  assert.equal(host.h.blurCalls, 0, "blocking never blurs the field");

  host.setOverlayBlocked(false);
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0, "unblocking the same session does not replay focus");
  assert.equal(host.h.blurCalls, 0);
});

test("a scoped field mounted under a covering overlay never takes focus", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: true, session: 1 },
    null,
    true,
  );
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0);
  assert.equal(host.h.pendingFrames, 0);

  host.setOverlayBlocked(false);
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0, "an initial blocked mount has no deferred intent");
  assert.equal(host.h.blurCalls, 0);
});

test("an unscoped native field mounted under a covering overlay skips mount autoFocus", () => {
  const host = createInputHost({ label: "Email", value: "", autoFocus: true }, null, null, true);
  assert.equal(host.input().props.autoFocus, false, "blocked native mounts suppress autoFocus");
  assert.equal(host.h.autoFocusRequests, 0);
  host.setOverlayBlocked(false);
  assert.equal(host.input().props.autoFocus, true, "the prop resumes once unblocked");
  assert.equal(host.h.autoFocusRequests, 0, "but the mount has passed, so focus is not stolen");
  assert.equal(host.h.focusCalls, 0);
  assert.equal(host.h.mounts, 1);
});

test("backgrounding before the queued scoped frame cancels the take for good", () => {
  for (const state of ["background", "inactive"]) {
    const host = createInputHost(
      { label: "Link", value: "", autoFocus: true },
      { active: true, ready: false, session: 1 },
    );
    host.setScope({ active: true, ready: true, session: 1 });
    assert.equal(host.h.pendingFrames, 1);
    assert.equal(host.h.appStateListenerCount, 1, "the take subscribes only while pending");

    host.h.setAppState(state);
    assert.equal(host.h.pendingFrames, 0, `${state} cancels the queued frame`);
    assert.equal(host.h.appStateListenerCount, 0, `${state} removes the ephemeral listener`);
    host.h.setAppState("active");
    host.h.runFrames();

    assert.equal(host.h.focusCalls, 0, `resume after ${state} must not reopen the IME`);
    assert.equal(host.h.blurCalls, 0, `resume after ${state} must not blur a field`);
    assert.equal(host.h.appStateListenerCount, 0);
  }
});

test("a field readied while backgrounded never queues focus on resume", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: true, session: 1 },
    null,
    false,
    "background",
  );
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0);
  assert.equal(host.h.pendingFrames, 0);
  assert.equal(host.h.appStateListenerCount, 0, "no listener is installed for a backgrounded take");

  host.h.setAppState("active");
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0, "foreground resume does not replay the initial take");
  assert.equal(host.h.blurCalls, 0);
});

test("a fresh session after background still takes focus once", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: false, session: 1 },
  );
  host.setScope({ active: true, ready: true, session: 1 });
  host.h.setAppState("background");
  host.h.setAppState("active");
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0);

  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  assert.equal(host.h.pendingFrames, 1);
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 1, "a fresh session still takes focus once");
  assert.equal(host.h.blurCalls, 0);
  assert.equal(host.h.appStateListenerCount, 0);
});

test("backgrounding while the panel is still measuring cancels the same-session take", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: false, session: 1 },
  );
  assert.equal(host.h.pendingFrames, 0);
  assert.equal(host.h.appStateListenerCount, 1, "the waiting intent is observed before measurement");

  host.h.setAppState("background");
  assert.equal(host.h.appStateListenerCount, 0, "background cancels the waiting intent");
  host.h.setAppState("active");
  host.setScope({ active: true, ready: true, session: 1 });
  assert.equal(host.h.pendingFrames, 0, "resuming and measuring cannot revive the take");
  host.h.runFrames();

  assert.equal(host.h.focusCalls, 0);
  assert.equal(host.h.blurCalls, 0);
  assert.equal(host.h.appStateListenerCount, 0);
});

test("a new session after a backgrounded measurement still focuses once", () => {
  const host = createInputHost(
    { label: "Link", value: "", autoFocus: true },
    { active: true, ready: false, session: 1 },
  );
  host.h.setAppState("background");
  host.h.setAppState("active");
  host.setScope({ active: true, ready: true, session: 1 });
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 0, "the interrupted first session stays consumed");

  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  assert.equal(host.h.pendingFrames, 1);
  host.h.runFrames();
  assert.equal(host.h.focusCalls, 1, "a fresh session can still take focus once");
  assert.equal(host.h.blurCalls, 0);
  assert.equal(host.h.appStateListenerCount, 0);
});
