/** Run with: node --test apps/mobile/scripts/library-search-ring.test.cjs
 *
 * Regression tests for the library search bar's focus ring
 * (components/bookmarks/LibraryHeader.tsx):
 *
 * The editing session (Back/clear/filters chrome, preserved query, Back
 * handling) and the field's real focus are separate signals. The ring must
 * follow only the real focus: when an overlay (save sheet, folder picker)
 * steals focus, the ring clears while the search chrome and query stay;
 * nothing refocuses the field on blur (no false autofocus restore); the
 * input is never remounted across the focused -> blur -> resume cycle.
 *
 * The harness executes the actual component source (transpiled with the
 * workspace TypeScript) with renderer-like JSX: function components run
 * inline so their hooks stay in one tracked order.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function reactHarness() {
  const slots = [], effects = [];
  let cursor = 0, changed = false;
  const depsEqual = (a, b) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
  function effect(callback, deps) {
    const index = cursor++, old = slots[index];
    if (old && depsEqual(deps, old.deps)) return;
    effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
  }
  const react = {
    memo: (component) => component,
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (value) => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; changed = true; }
      }];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(deps, slots[index].deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(deps, slots[index].deps)) slots[index] = { deps, value: callback };
      return slots[index].value;
    },
    useLayoutEffect: effect, useEffect: effect,
  };
  react.default = react;
  return {
    react,
    markDirty() { changed = true; },
    render(callback) {
      let result, commits = 0;
      do {
        changed = false; cursor = 0; effects.length = 0;
        result = callback();
        effects.forEach((run) => run());
        assert.ok(++commits < 25, "commit loop did not settle");
      } while (changed);
      return result;
    },
  };
}

function transpile(relative) {
  return ts.transpileModule(readFileSync(resolve(__dirname, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function findNode(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => findNode(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : findNode(node.props?.children, predicate);
}

function headerHost() {
  const h = reactHarness();
  const events = [];
  const registered = [];
  const overlay = { blocked: false };
  const searchBack = { editing: undefined, exit: null, filterOpen: undefined };
  const inputRefs = [];
  const inputNode = {
    focusCalls: 0,
    focus() { inputNode.focusCalls++; holder.onFocus?.({ nativeEvent: {} }); },
    blur() { holder.onBlur?.({ nativeEvent: {} }); },
    clear() {},
  };
  const holder = { onFocus: null, onBlur: null };
  const motion = { reducedMotion: false, spatial: { stiffness: 700 }, expressive: false };
  const mocks = {
    react: h.react,
    "react/jsx-runtime": {
      // Renderer-like: function components execute inline, so LibrarySearch
      // and SearchBarActions run with tracked hooks in a stable order.
      jsx: (type, props) => (typeof type === "function" ? type(props) : { type, props }),
      jsxs: (type, props) => (typeof type === "function" ? type(props) : { type, props }),
      Fragment: "Fragment",
    },
    "react-native": {
      Keyboard: { dismiss: () => events.push("keyboard-dismiss") },
      Platform: { OS: "web" },
      StyleSheet: { create: (v) => v, absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } },
      TextInput: Object, View: "View",
    },
    "react-native-reanimated": {
      default: undefined, // replaced below (self-reference)
      Animated: { View: "AnimatedView" },
      useSharedValue(initial) {
        const ref = h.react.useRef(undefined);
        if (!ref.current) {
          const box = { stored: initial };
          Object.defineProperty(box, "value", {
            get() { return box.stored; },
            set(next) { box.stored = next; h.markDirty(); },
            configurable: true,
          });
          ref.current = box;
        }
        return ref.current;
      },
      useAnimatedStyle: (factory) => factory(),
      withSpring: (target) => target,
    },
    "expo-router": { useFocusEffect: (callback) => h.react.useEffect(callback, []) },
    "../../hooks/use-app-router": { useAppRouter: () => ({ navigate: () => {} }) },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    "../../hooks/use-scene-column-insets": { useColumnPadding: () => ({ left: 0, right: 0 }) },
    "../../theme/material-motion": {
      materialMotion: { effects: { fast: { duration: 100 }, spatial: { duration: 200 } } },
      useMaterialMotion: () => motion,
    },
    "../../hooks/use-search-back": {
      useSearchBack: (editing, exit, filterOpen) => { searchBack.editing = editing; searchBack.exit = exit; searchBack.filterOpen = filterOpen; },
    },
    "../../store/auth": { useAuthStore: (selector) => selector({ user: { displayName: "Repro" } }) },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: { primary: "teal", onSurfaceVariant: "x", onSecondaryContainer: "y", surfaceContainerHigh: "z", overlay: "o" } }) },
    "../../theme/tokens": { layout: { maxContentWidth: 800 }, radius: { full: 999 }, spacing: { 4: 4, 8: 8, 16: 16 } },
    "../../lib/search-field-focus": { registerSearchFieldFocus: (focus) => { registered.push(focus); return () => {}; } },
    "../ui/overlay-host": { useOverlayBlocked: () => overlay.blocked },
    "../ui/MaterialIcon": { MaterialIcon: "MaterialIcon" },
    "../ui/Input": {
      Input: (props) => {
        holder.onFocus = props.onFocus;
        holder.onBlur = props.onBlur;
        if (props.ref) { inputRefs.push(props.ref); if (!props.ref.current) props.ref.current = inputNode; }
        return { type: "Input", props };
      },
    },
    "../ui/IconButton": { IconButton: "IconButton" },
    "../ui/Header": { HeaderIconButton: "HeaderIconButton" },
    "../ui/PressableScale": { PressableScale: "PressableScale" },
    "../ui/Text": { Text: "Text" },
    "../ui/UserAvatar": { UserAvatar: "UserAvatar" },
    "./SelectionHeader": { SelectionHeader: "SelectionHeader" },
    "../../theme/app-bar-layout": { appBarLayout: () => ({ paddingTop: 0, paddingBottom: 0 }) },
    "../../hooks/use-responsive-layout": { useResponsiveLayout: () => ({ compactHeight: false }) },
  };
  const outputText = transpile("../src/components/bookmarks/LibraryHeader.tsx");
  // The real reanimated default export *is* the Animated namespace.
  mocks["react-native-reanimated"].default = { View: "AnimatedView" };
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)((id) => mocks[id] ?? {}, mod, mod.exports);
  const { LibraryHeader } = mod.exports;
  const props = {
    tools: { type: "Tools", props: {} },
    query: "",
    onQueryChange: (next) => events.push(`query:${next}`),
    onFilter: () => events.push("filter"),
    filtersOn: false,
    filterOpen: false,
  };
  const host = {
    h, events, registered, searchBack, inputRefs, inputNode, props, tree: null, overlay,
    render: (overrides = {}) => { host.tree = h.render(() => LibraryHeader({ ...props, ...overrides })); return host.tree; },
    input: () => findNode(host.tree, (n) => n.type === "Input")?.props,
    ringOpacity: () => {
      const ring = findNode(host.tree, (n) => n.type === "AnimatedView" && n.props.testID === "library-search-focus-ring");
      const animated = (ring.props.style ?? []).find((entry) => entry && typeof entry.opacity === "number");
      return animated ? animated.opacity : undefined;
    },
    /** SearchBarActions render as AnimatedViews; classify by a labeled descendant. */
    slot: (label) => findNode(host.tree, (n) => (n.type === "View" || n.type === "AnimatedView") && n.props.pointerEvents !== undefined
      && findNode(n.props.children, (child) => child.props?.accessibilityLabel === label)),
    focus: () => { host.input().onFocus({ nativeEvent: {} }); host.render(); },
    blur: () => { host.input().onBlur({ nativeEvent: {} }); host.render(); },
  };
  return host;
}

test("ring follows real focus while the editing session survives a stolen focus", () => {
  const host = headerHost();
  host.render();
  assert.equal(host.ringOpacity(), 0, "no ring before the field is focused");
  assert.equal(host.input().placeholder, "Library", "idle placeholder");

  host.focus();
  assert.equal(host.ringOpacity(), 1, "ring shows on focus");
  assert.equal(host.input().placeholder, "Search your library", "editing placeholder");
  assert.equal(host.slot("Account and settings").props.pointerEvents, "none", "tools slot hidden by the editing session");
  assert.equal(host.slot("Exit search").props.pointerEvents, "box-none", "search back stays reachable");
  assert.equal(host.searchBack.editing, true, "Back still exits the search session");

  // An overlay (save sheet / folder picker) steals focus.
  host.blur();
  assert.equal(host.ringOpacity(), 0, "ring clears when focus leaves — no stale indicator behind overlays");
  assert.equal(host.slot("Account and settings").props.pointerEvents, "none", "editing chrome stays: tools are not re-shown mid-session");
  assert.equal(host.slot("Exit search").props.pointerEvents, "box-none", "search chrome stays mounted for the session");
  assert.equal(host.input().placeholder, "Search your library", "still in editing mode");
  assert.equal(host.searchBack.editing, true, "Back still belongs to the search session");
});

test("focused -> blur (picker) -> resume keeps the query, chrome, and input node", () => {
  const host = headerHost();
  host.render();
  host.focus();
  host.input().onChangeText("podcast");
  host.render();
  assert.deepEqual(host.events.filter((e) => e.startsWith("query:")), ["query:podcast"]);

  host.blur();
  host.input().onFocus({ nativeEvent: {} });
  host.render();

  assert.equal(host.input().value, "podcast", "typed query survives the blur/resume cycle");
  assert.equal(host.input().placeholder, "Search your library", "editing session retained");
  assert.equal(host.ringOpacity(), 1, "ring returns with real focus");
  assert.ok(new Set(host.inputRefs).size === 1, "the same input ref object is reused — no remount");
  assert.equal(host.inputNode.focusCalls, 0, "resume is user-driven; no autofocus restore fired");
});

test("exiting search clears ring, chrome, and session together", () => {
  const host = headerHost();
  host.render();
  host.focus();
  host.input().onChangeText("podcast");
  host.render();
  host.blur(); // focus already stolen by an overlay before exiting
  host.searchBack.exit(); // Back / submit path
  host.render();

  assert.equal(host.ringOpacity(), 0, "ring stays off after exit");
  assert.equal(host.slot("Account and settings").props.pointerEvents, "box-none", "tools slot returns");
  assert.equal(host.slot("Exit search").props.pointerEvents, "none", "search chrome leaves");
  assert.equal(host.input().placeholder, "Library", "back to idle");
  assert.equal(host.searchBack.editing, false, "Back no longer exits search");
  assert.ok(host.events.includes("keyboard-dismiss"), "IME is dismissed on exit");
  // The exit path reports the input-focus loss even though the field was
  // already blurred, so a native blur-less Keyboard.dismiss cannot strand it.
  assert.equal(host.ringOpacity(), 0);
});

test("route autofocus still focuses once; blur never schedules a restore", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = headerHost();
    host.render({ autoFocusSearch: true });
    t.mock.timers.tick(200);
    assert.equal(host.inputNode.focusCalls, 1, "autoFocus fires once after the route settles");
    host.render({ autoFocusSearch: true }); // flush the focus event into the tree
    assert.equal(host.ringOpacity(), 1);
    host.blur();
    t.mock.timers.tick(1000);
    assert.equal(host.inputNode.focusCalls, 1, "no refocus is scheduled when focus leaves");
    assert.equal(host.ringOpacity(), 0);
  } finally {
    t.mock.timers.reset();
  }
});

test("the search field stays registered for tab-press focusing", () => {
  const host = headerHost();
  host.render();
  assert.equal(host.registered.length, 1, "focus handler registered while the library is focused");
  host.registered[0]();
  assert.equal(host.inputNode.focusCalls, 1, "registered handler focuses the field");
  host.render();
  assert.equal(host.ringOpacity(), 1, "focus signal propagates to the ring");
});

test("route autofocus spent behind an overlay is not replayed when it closes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = headerHost();
    host.render({ autoFocusSearch: true });
    t.mock.timers.tick(100);

    // The save sheet opens before the 200ms route timer fires.
    host.overlay.blocked = true;
    host.render({ autoFocusSearch: true });
    t.mock.timers.tick(100); // the original deadline passes while blocked
    assert.equal(host.inputNode.focusCalls, 0, "no focus while an overlay owns the surface");
    assert.equal(host.ringOpacity(), 0, "no focus ring behind the overlay");

    // Unblocking is not a new route request; the spent intent must not replay.
    host.overlay.blocked = false;
    host.render({ autoFocusSearch: true });
    t.mock.timers.tick(1000);
    assert.equal(host.inputNode.focusCalls, 0, "closing the overlay must not refocus the library");
    assert.equal(host.ringOpacity(), 0, "the field never gained focus");

    // A genuinely new autoFocus request still works exactly once.
    host.render({ autoFocusSearch: false });
    host.render({ autoFocusSearch: true });
    t.mock.timers.tick(200);
    assert.equal(host.inputNode.focusCalls, 1, "a fresh route request focuses once");
    host.render({ autoFocusSearch: true });
    assert.equal(host.ringOpacity(), 1, "the fresh focus reaches the ring");
    t.mock.timers.tick(1000);
    assert.equal(host.inputNode.focusCalls, 1, "the fresh request never repeats");
  } finally {
    t.mock.timers.reset();
  }
});

test("route autofocus requested while blocked is not replayed after unblock", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = headerHost();
    host.overlay.blocked = true;
    host.render({ autoFocusSearch: true });
    t.mock.timers.tick(200);
    assert.equal(host.inputNode.focusCalls, 0, "a blocked request never takes focus");
    host.overlay.blocked = false;
    host.render({ autoFocusSearch: true });
    t.mock.timers.tick(1000);
    assert.equal(host.inputNode.focusCalls, 0, "unblocking must not replay the consumed request");
    assert.equal(host.ringOpacity(), 0);
  } finally {
    t.mock.timers.reset();
  }
});

test("raw background focus is refused while an overlay owns the library", () => {
  const host = headerHost();
  host.render();
  host.overlay.blocked = true;
  host.render();

  // Focus can arrive from a native fallback/consumer without going through the
  // registered tab handler. It must not start an editing session behind the
  // overlay or light the ring.
  host.focus();
  assert.equal(host.ringOpacity(), 0, "no focus ring behind the overlay");
  assert.equal(host.input().placeholder, "Library", "the library never enters its editing session");
});

test("tab focus refuses a blocked take and resumes without losing the session", () => {
  const host = headerHost();
  host.render();
  host.focus();
  host.input().onChangeText("podcast");
  host.render();
  host.blur(); // the overlay steals focus; the editing session stays

  host.overlay.blocked = true;
  host.render();
  host.registered[0]();
  assert.equal(host.inputNode.focusCalls, 0, "the tab handler must not focus behind an overlay");
  assert.equal(host.ringOpacity(), 0, "no false focus ring behind the overlay");
  assert.equal(host.input().value, "podcast", "query preserved while blocked");
  assert.equal(host.input().placeholder, "Search your library", "editing session preserved while blocked");
  assert.equal(host.slot("Exit search").props.pointerEvents, "box-none", "search chrome stays reachable afterwards");

  host.overlay.blocked = false;
  host.render();
  host.registered[0]();
  assert.equal(host.inputNode.focusCalls, 1, "an explicit tab press focuses after the overlay closes");
  host.render();
  assert.equal(host.ringOpacity(), 1, "focus ring restores with the real focus");
  assert.equal(host.input().value, "podcast", "query survives the blocked take");
  assert.ok(new Set(host.inputRefs).size === 1, "the same input node is reused — no remount");
});
