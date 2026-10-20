/**
 * Focus ownership for the segmented OTP field.
 * Run with: node --test apps/mobile/scripts/otp-focus-ownership.test.cjs
 *
 * The regression: OtpInput's delayed autoFocus and its layout-effect cell
 * routing ignored the shared input focus scope, overlay blocking, and app /
 * animation activity. A retained auth screen or PIN sheet covered by Save (or
 * an app background / sibling picker) could still take native focus behind the
 * active surface, and a stale focused cell could be restored when the cover
 * went away.
 *
 * This harness runs the real OtpInput.tsx (plus the real otp-edit/layout/
 * autofill helpers and input-focus-scope context) against a minimal hooks host.
 * TextInput hosts record real focus transitions and blurs; timers are manual so
 * the 280 ms take and 80 ms completion are observable without wall-clock waits.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test, after } = require("node:test");
const ts = require("typescript");

const sourceRoot = process.env.ORDO_OTP_SOURCE_ROOT ?? resolve(__dirname, "../src");
const originalTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const originalDocument = globalThis.document;

function transpile(filename) {
  return ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function depsEqual(a, b) {
  return a === b || (!!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
}

function reactHarness() {
  // ------------------------------------------------------------- hooks host
  const hookFrames = new Map();
  const layoutEffects = [];
  const passiveEffects = [];
  let activeFrame = null;
  let activePath = "";
  let changed = false;
  let commits = 0;

  let now = 0;
  let timerId = 0;
  const timers = new Map();
  globalThis.setTimeout = (callback, ms) => {
    const id = ++timerId;
    timers.set(id, { at: now + (Number(ms) || 0), callback });
    return id;
  };
  globalThis.clearTimeout = (id) => { timers.delete(id); };

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

  const contextDefaults = [];
  const react = {
    useState: state,
    useReducer(reducer, initial) {
      const index = activeFrame.cursor++;
      const frame = activeFrame;
      if (!(index in frame.slots)) frame.slots[index] = initial;
      return [frame.slots[index], (action) => {
        const next = reducer(frame.slots[index], action);
        if (!Object.is(next, frame.slots[index])) { frame.slots[index] = next; changed = true; }
      }];
    },
    useRef(initial) {
      const index = activeFrame.cursor++;
      return activeFrame.slots[index] ??= { current: initial };
    },
    useMemo(factory) { activeFrame.cursor++; return factory(); },
    useCallback(callback) { activeFrame.cursor++; return callback; },
    useEffect: effect(passiveEffects),
    useLayoutEffect: effect(layoutEffects),
    useId: () => "otp-test-id",
    useContext: (context) => context?._current,
    createContext(initial) {
      const context = { _current: initial, Provider: null, Consumer: null };
      context.Provider = { __context: context };
      context.Consumer = { __context: context };
      contextDefaults.push(context);
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

  // ----------------------------------------------------------- platform/mocks
  let platformOS = "android";
  const fakeBody = { nodeName: "BODY" };
  const fakeDocument = { body: fakeBody, activeElement: fakeBody };
  globalThis.document = fakeDocument;

  let overlayBlocked = false;
  let routeLocked = false;
  let activity = true;

  const palette = Object.fromEntries([
    "surface", "surfaceElevated", "text", "onSurface", "outline", "borderStrong", "accent",
    "onErrorContainer", "dangerSoft", "primaryContainer", "onPrimaryContainer", "mode",
  ].map((role) => [role, role === "mode" ? "dark" : "#123456"]));
  const spacing = { 2: 2, 4: 4, 6: 6, 8: 8, 12: 12, 16: 16, 24: 24 };

  let keyboardVisible = true;
  const reactNative = {
    Platform: {
      get OS() { return platformOS; },
      select: (choices) => choices[platformOS] ?? choices.default ?? {},
    },
    Keyboard: { isVisible: () => keyboardVisible },
    StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    TextInput: "TextInput",
    View: "View",
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  };

  const Animated = {
    View: "AnimatedView",
    Text: "AnimatedText",
    createAnimatedComponent: (type) => type,
  };
  const reanimated = {
    default: Animated,
    ...Animated,
    useSharedValue: (value) => ({ value }),
    useAnimatedStyle: () => ({}),
    cancelAnimation: () => {},
    interpolate: (value, input, output) => output?.[0] ?? 0,
    interpolateColor: () => "#000000",
    Extrapolation: { CLAMP: "clamp" },
    Easing: {
      out: (fn) => fn, inOut: (fn) => fn, in: (fn) => fn,
      cubic: (x) => x, quad: (x) => x, ease: (x) => x,
      bezier: () => (x) => x,
    },
    withDelay: (_delay, value) => value,
    withRepeat: (value) => value,
    withSequence: (...values) => values[values.length - 1],
    withSpring: (value) => value,
    withTiming: (value) => value,
  };

  const inputSurface = react.createContext(null);

  const moduleCache = new Map();
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
      if (name === "@ordo/shared") return { EMAIL_OTP: { LENGTH: 6 }, MFA: { BACKUP_CODE_LENGTH: 8 } };
      if (name === "./Text") return { Text: "Text" };
      if (name === "../../theme/ThemeProvider") return { useTheme: () => ({ palette }) };
      if (name === "../../theme/tokens") return {
        fontSize: { "2xl": 24, "3xl": 32, md: 16 },
        radius: { sm: 4 },
        resolveFont: () => undefined,
        spacing,
      };
      if (name === "../../theme/material-motion") return {
        materialMotion: { effects: { fast: {} }, fast: {}, spatial: {} },
        useMaterialMotion: () => ({ reducedMotion: false, fast: {}, spatial: {} }),
      };
      if (name === "../../theme/state-layer") return { alphaTint: () => "rgba(0,0,0,0.38)" };
      if (name === "../../lib/haptics") return { haptics: { selection() {}, success() {}, error() {} } };
      if (name === "./input-surface") return { InputSurfaceContext: inputSurface };
      if (name === "./input-focus-scope") return load(resolve(sourceRoot, "components/ui/input-focus-scope.ts"));
      if (name === "./overlay-host") return { useOverlayBlocked: () => overlayBlocked };
      if (name === "../../lib/otp-edit") return load(resolve(sourceRoot, "lib/otp-edit.ts"));
      if (name === "../../lib/otp-autofill") return load(resolve(sourceRoot, "lib/otp-autofill.ts"));
      if (name === "../../lib/otp-layout") return load(resolve(sourceRoot, "lib/otp-layout.ts"));
      if (name === "../../lib/focus-text-input") return load(resolve(sourceRoot, "lib/focus-text-input.ts"));
      if (name === "../../hooks/use-credential-lock") return { useCredentialLock: () => routeLocked };
      if (name === "../../hooks/use-animation-activity") return { useAnimationActivity: () => activity };
      throw new Error(`Unexpected import ${name} from ${filename}`);
    };
    new Function("require", "module", "exports", output)(localRequire, module, module.exports);
    return module.exports;
  }

  // ------------------------------------------------------------ TextInput host
  let nativeFocused = null;
  let focusCalls = 0;
  let focusTransitions = 0;
  let blurCalls = 0;
  const focusLog = [];
  const blurLog = [];
  const textHosts = new Map();
  let nextNativeId = 0;

  function cellIndexFromLabel(label) {
    const match = typeof label === "string" ? label.match(/ (\d+) of \d+$/) : null;
    return match ? Number(match[1]) - 1 : -1;
  }

  function renderTextInput(path, key, props) {
    let host = textHosts.get(path);
    if (!host || host.key !== key) {
      const instance = {
        id: ++nextNativeId,
        index: -1,
        props,
        focus() {
          focusCalls++;
          const wasFocused = nativeFocused === instance;
          focusLog.push({ index: instance.index, wasFocused, at: now });
          if (wasFocused) return;
          focusTransitions++;
          nativeFocused = instance;
          fakeDocument.activeElement = instance;
          instance.props.onFocus?.({ nativeEvent: {} });
        },
        blur() {
          blurCalls++;
          blurLog.push({ index: instance.index, at: now });
          if (nativeFocused === instance) nativeFocused = null;
          if (fakeDocument.activeElement === instance) fakeDocument.activeElement = fakeBody;
          instance.props.onBlur?.({ nativeEvent: {} });
        },
        isFocused() { return nativeFocused === instance; },
      };
      host = { key, instance };
      textHosts.set(path, host);
    }
    const instance = host.instance;
    instance.props = props;
    instance.index = cellIndexFromLabel(props.accessibilityLabel);
    props.ref?.(instance);
    return { type: "TextInput", key, props, instance };
  }

  // --------------------------------------------------------------- renderer
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
    if (node.type === reactNative.TextInput) return renderTextInput(path, key, props);
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
      assert.ok(++commits < 60, "commit loop did not settle");
    } while (changed);
    return tree;
  }

  function advance(ms) {
    const end = now + ms;
    let guard = 0;
    while (true) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
      }
      if (!next) break;
      timers.delete(next.id);
      now = next.timer.at;
      next.timer.callback();
      if (changed && lastFactory) render(lastFactory);
      assert.ok(++guard < 30, "timer loop did not settle");
    }
    now = end;
    if (changed && lastFactory) render(lastFactory);
  }

  function cell(index) {
    for (const host of textHosts.values()) if (host.instance.index === index) return host.instance;
    return null;
  }

  let otpInput = null;
  let scopeContext = null;

  return {
    react,
    loadOtpInput() {
      otpInput = load(resolve(sourceRoot, "components/ui/OtpInput.tsx")).OtpInput;
      scopeContext = load(resolve(sourceRoot, "components/ui/input-focus-scope.ts")).InputFocusScopeContext;
      return otpInput;
    },
    get scopeContext() { return scopeContext; },
    render,
    advance,
    cell,
    get now() { return now; },
    get pendingTimers() { return timers.size; },
    get focusCalls() { return focusCalls; },
    get focusTransitions() { return focusTransitions; },
    get blurCalls() { return blurCalls; },
    get focusLog() { return focusLog; },
    get blurLog() { return blurLog; },
    get nativeFocused() { return nativeFocused; },
    get activeElement() { return fakeDocument.activeElement; },
    get body() { return fakeBody; },
    setPlatform(value) { platformOS = value; },
    setOverlayBlocked(value) { overlayBlocked = value; },
    setRouteLocked(value) { routeLocked = value; },
    setActivity(value) { activity = value; },
    setKeyboardVisible(value) { keyboardVisible = value; },
  };
}

function createOtpHost(options = {}) {
  const h = reactHarness();
  h.setPlatform(options.platform ?? "android");
  h.setOverlayBlocked(!!options.blocked);
  h.setRouteLocked(!!options.routeLocked);
  h.setActivity(options.activity ?? true);
  const OtpInput = h.loadOtpInput();

  const state = {
    value: options.value ?? "",
    autoFocus: options.autoFocus ?? true,
    editable: options.editable ?? true,
    status: options.status ?? "idle",
    completions: [],
    changes: [],
  };
  let scope = options.scope ?? null;
  const baseProps = {
    kind: options.kind ?? "numeric",
    length: options.length,
    purpose: options.purpose ?? "otp",
  };

  const host = {
    h,
    render() {
      h.render(() => ({
        type: h.scopeContext.Provider,
        props: {
          value: scope,
          children: {
            type: OtpInput,
            props: {
              ...baseProps,
              value: state.value,
              autoFocus: state.autoFocus,
              editable: state.editable,
              status: state.status,
              onChange: (value) => {
                state.value = value;
                state.changes.push(value);
              },
              onComplete: (code) => { state.completions.push(code); },
            },
          },
        },
      }));
      return host;
    },
    input(index) {
      const instance = h.cell(index);
      assert.ok(instance, `cell ${index} is mounted`);
      return instance;
    },
    pendingTimers() { return h.pendingTimers; },
    advance(ms) { h.advance(ms); return host; },
    setValue(value) { state.value = value; return host.render(); },
    setAutoFocus(value) { state.autoFocus = value; return host.render(); },
    setEditable(value) { state.editable = value; return host.render(); },
    setStatus(value) { state.status = value; return host.render(); },
    setScope(next) { scope = next; return host.render(); },
    setBlocked(value) { h.setOverlayBlocked(value); return host.render(); },
    setActivity(value) { h.setActivity(value); return host.render(); },
    setRouteLocked(value) { h.setRouteLocked(value); return host.render(); },
    setKeyboardVisible(value) { h.setKeyboardVisible(value); return host; },
    focus(index) {
      host.input(index).focus();
      return host.render();
    },
    blur(index) {
      host.input(index).blur();
      return host.render();
    },
    type(index, text) {
      host.input(index).props.onChangeText(text);
      return host.render();
    },
    get value() { return state.value; },
    get changes() { return state.changes; },
    get completions() { return state.completions; },
    get transitions() { return h.focusTransitions; },
    get blurCalls() { return h.blurCalls; },
    get focusTargets() { return h.focusLog.map((entry) => entry.index); },
    get blurTargets() { return h.blurLog.map((entry) => entry.index); },
    get activeElement() { return h.activeElement; },
    get body() { return h.body; },
  };
  host.render();
  return host;
}

after(() => {
  globalThis.setTimeout = originalTimers.setTimeout;
  globalThis.clearTimeout = originalTimers.clearTimeout;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

test("active OTP still advances focus to the next cell while typing", () => {
  const host = createOtpHost();
  host.advance(280);
  assert.equal(host.transitions, 1, "mount autoFocus takes the first cell once");
  assert.equal(host.focusTargets.at(-1), 0);

  host.type(0, "1");
  assert.equal(host.transitions, 2, "typing advances to cell 2");
  assert.equal(host.focusTargets.at(-1), 1);

  host.type(1, "2");
  assert.equal(host.transitions, 3, "typing advances to cell 3");
  assert.equal(host.focusTargets.at(-1), 2);
  assert.equal(host.value, "12");
  assert.equal(host.blurCalls, 0, "advancing never blurs the IME");
});

test("a covering overlay before the autoFocus delay cancels it without replay", () => {
  const host = createOtpHost();
  host.advance(120);
  assert.equal(host.transitions, 0);

  host.setBlocked(true);
  host.advance(500);
  assert.equal(host.transitions, 0, "covered OTP never takes focus");
  assert.equal(host.blurCalls, 0, "covering the field does not blur its IME");

  host.setBlocked(false);
  host.advance(500);
  assert.equal(host.transitions, 0, "uncovering the same mount does not replay autoFocus");
});

test("an OTP mounted under a covering overlay never takes focus", () => {
  const host = createOtpHost({ blocked: true });
  host.advance(500);
  assert.equal(host.transitions, 0);
  host.setBlocked(false);
  host.advance(500);
  assert.equal(host.transitions, 0, "the deferred intent is consumed by the cover");
});

test("app background cancels the delayed autoFocus and foreground does not replay it", () => {
  const host = createOtpHost({ activity: false });
  host.advance(500);
  assert.equal(host.transitions, 0, "a backgrounded owner does not focus");

  host.setActivity(true);
  host.advance(500);
  assert.equal(host.transitions, 0);
});

test("an inactive owner (editable false) never focuses after it becomes editable", () => {
  const host = createOtpHost({ editable: false });
  host.advance(500);
  assert.equal(host.transitions, 0);
  host.setEditable(true);
  host.advance(500);
  assert.equal(host.transitions, 0);
});

test("scoped autoFocus waits for the owner's ready measurement", () => {
  const host = createOtpHost({ scope: { active: true, ready: false, session: 1 } });
  host.advance(400);
  assert.equal(host.transitions, 0, "a not-ready panel cannot take focus yet");

  host.setScope({ active: true, ready: true, session: 1 });
  host.advance(280);
  assert.equal(host.transitions, 1, "the ready panel takes focus once");
});

test("a scope that starts inactive never focuses when it resumes in the same session", () => {
  const host = createOtpHost({ scope: { active: false, ready: true, session: 1 } });
  host.advance(500);
  assert.equal(host.transitions, 0);

  host.setScope({ active: true, ready: true, session: 1 });
  host.advance(500);
  assert.equal(host.transitions, 0, "same-session resume is not a new opening");
});

test("rapid close before the delay cancels the take; a new session takes focus once", () => {
  const host = createOtpHost({ scope: { active: true, ready: true, session: 1 } });
  host.advance(120);
  host.setScope({ active: false, ready: true, session: 1 });
  host.advance(400);
  assert.equal(host.transitions, 0, "a closing owner cancels its pending take");

  host.setScope({ active: true, ready: true, session: 2 });
  host.advance(280);
  assert.equal(host.transitions, 1, "the next opening may take focus once");
  host.advance(500);
  assert.equal(host.transitions, 1, "the new session does not take focus twice");
});

test("a retained OTP takes focus once per new scoped opening, not on picker resume", () => {
  const host = createOtpHost({ scope: { active: true, ready: true, session: 1 } });
  host.advance(280);
  assert.equal(host.transitions, 1);

  // A sibling picker suspends the parent; the OTP cell keeps native focus.
  host.setScope({ active: false, ready: true, session: 1 });
  host.advance(300);
  assert.equal(host.transitions, 1, "suspension does not move focus");
  host.setScope({ active: true, ready: true, session: 1 });
  host.advance(500);
  assert.equal(host.transitions, 1, "picker resume in the same session does not replay focus");

  // Closing the panel moves focus back to its trigger, then reopening is a
  // fresh visible session and may take focus once.
  host.blur(0);
  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  host.advance(280);
  assert.equal(host.transitions, 2, "the retained field focuses once for the new session");
  host.advance(500);
  assert.equal(host.transitions, 2);
});

test("route value changes while inactive do not focus a new cell or restore the old one", () => {
  const host = createOtpHost({ autoFocus: false, value: "12345" });
  host.focus(5);
  assert.equal(host.transitions, 1);

  host.setRouteLocked(true);
  host.setValue("9");
  host.advance(500);
  assert.equal(host.transitions, 1, "a shortened route value does not focus cell 2 while locked");

  host.setRouteLocked(false);
  host.advance(500);
  assert.equal(host.transitions, 1, "unlocking does not restore the stale focused cell");
});

test("a route value change while a scoped owner is suspended does not focus a new cell", () => {
  const host = createOtpHost({
    autoFocus: false,
    value: "12345",
    scope: { active: true, ready: true, session: 1 },
  });
  host.focus(5);
  assert.equal(host.transitions, 1);

  host.setScope({ active: false, ready: true, session: 1 });
  host.setValue("9");
  assert.equal(host.transitions, 1, "a sibling picker keeps focus out of the OTP");

  host.setScope({ active: true, ready: true, session: 1 });
  assert.equal(host.transitions, 1, "returning from the picker does not restore the stale cell");
});

test("a covering overlay clears the old focused cell instead of restoring it", () => {
  const host = createOtpHost({ autoFocus: false, value: "12345" });
  host.focus(5);
  assert.equal(host.transitions, 1);

  host.setBlocked(true);
  host.setValue("9");
  host.advance(500);
  assert.equal(host.transitions, 1, "no focus behind the cover");

  host.setBlocked(false);
  host.advance(500);
  assert.equal(host.transitions, 1, "uncovering leaves focus where the user put it");
});

test("a failed verification still restores its chosen cell for a retry", () => {
  const host = createOtpHost({ autoFocus: false, value: "1234", length: 4 });
  host.focus(3);
  assert.equal(host.transitions, 1);

  host.setStatus("loading");
  host.setEditable(false);
  host.blur(3);
  host.advance(100);
  assert.equal(host.transitions, 1, "verification keeps the failed cell selected");

  host.setStatus("error");
  host.setEditable(true);
  host.advance(100);
  assert.equal(host.transitions, 2, "the retry starts at the same cell");
  assert.equal(host.focusTargets.at(-1), 3);
  assert.equal(host.blurCalls, 1, "only the verification blur happened");
});

test("route lock still starts the first autoFocus once the screen becomes active", () => {
  const host = createOtpHost({ routeLocked: true });
  host.advance(500);
  assert.equal(host.transitions, 0, "a retained route cannot focus while inactive");

  host.setRouteLocked(false);
  host.advance(280);
  assert.equal(host.transitions, 1, "the active route takes focus once");
  host.advance(500);
  assert.equal(host.transitions, 1);
});

test("web keeps the actively edited cell focused without blurring it", () => {
  const host = createOtpHost({ platform: "web" });
  host.advance(280);
  assert.equal(host.transitions, 1);
  host.type(0, "1");
  assert.equal(host.transitions, 2);
  assert.equal(host.activeElement, host.input(1), "the web focus follows the next cell");
  assert.equal(host.blurCalls, 0, "active web editing is never blurred");
});

test("native IME is never blindly blurred when a cover arrives", () => {
  const host = createOtpHost();
  host.advance(280);
  assert.equal(host.transitions, 1);
  host.setBlocked(true);
  host.advance(500);
  assert.equal(host.transitions, 1);
  assert.equal(host.blurCalls, 0);
});

test("a new scoped opening reopens the retained Android cell whose IME Back hid", () => {
  const host = createOtpHost({ platform: "android", scope: { active: true, ready: true, session: 1 } });
  host.advance(280);
  assert.equal(host.transitions, 1);
  assert.equal(host.blurCalls, 0);

  // Android Back hid the IME but TextInputState still reports cell 1 focused.
  host.setKeyboardVisible(false);
  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  host.advance(280);

  assert.equal(host.transitions, 2, "the retained cell reopens the IME");
  assert.deepEqual(host.blurTargets, [0], "only the same OTP cell is reset");
});

test("routine cell routing never uses the Android hidden-IME reset", () => {
  const host = createOtpHost({ platform: "android" });
  host.advance(280);
  host.setKeyboardVisible(false);

  host.type(0, "1");
  assert.equal(host.transitions, 2, "typing still advances to the next cell");
  assert.deepEqual(host.blurTargets, [], "layout routing must not blink the IME");
});

test("a new scoped opening does not steal focus from a different OTP cell", () => {
  const host = createOtpHost({
    autoFocus: false,
    value: "123",
    platform: "android",
    scope: { active: true, ready: true, session: 1 },
  });
  host.focus(2);
  assert.equal(host.transitions, 1);
  host.setAutoFocus(true);
  host.setKeyboardVisible(false);

  host.setScope({ active: false, ready: true, session: 1 });
  host.setScope({ active: true, ready: true, session: 2 });
  host.advance(280);

  assert.equal(host.transitions, 1, "the deliberately focused cell keeps ownership");
  assert.deepEqual(host.blurTargets, [], "no cell is reset");
});

test("paste/autofill completion still fires after focus ownership changes", () => {
  const host = createOtpHost({ autoFocus: false });
  host.focus(0);
  host.type(2, "123456");
  assert.equal(host.value, "123456");
  assert.equal(host.focusTargets.at(-1), 5, "a complete paste ends on the last cell");
  host.advance(80);
  assert.deepEqual(host.completions, ["123456"]);
});
