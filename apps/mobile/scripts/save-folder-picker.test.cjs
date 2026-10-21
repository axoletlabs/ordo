/** Run with: node --test apps/mobile/scripts/save-folder-picker.test.cjs
 *
 * Regression tests for the Save bookmark -> folder/tag picker flow:
 * - components/bookmarks/FolderPickerMenu.tsx: search-field focus handoff
 *   (delayed take only while it owns the session; cancelled on dismissal,
 *   reopen races, remount, or deliberate pointer/key navigation), Material
 *   content inset (the search pill must not touch the menu edges), anchored
 *   width, IME handoff intent, virtualized list ownership, row callbacks.
 * - components/bookmarks/AddBookmarkSheet.tsx: the suspended save form
 *   releases the link field's focus when a dropdown opens, keeps its draft
 *   while the picker owns the surface, obscures only for sibling dialogs,
 *   hands the tag search focus only while the tag menu is the surface, gates
 *   every child surface by the parent's open commit, invalidates late
 *   clipboard reads on edit/close without focusing a background surface, and
 *   keeps a save settlement inside the opening/intake session that started it.
 * - Save-owned child callbacks (create folder/tag, unlock) act only for the
 *   child surface rendered in that same applied session.
 * - components/tags/TagSelectList.tsx: the additive `searchAutoFocus` opt-in.
 * - platform split: web keeps the cancellable opening take; native delegates
 *   initial focus to the owning overlay's Input focus scope.
 * - components/bookmarks/use-opening-focus.ts: the scoped delayed take.
 *
 * The harness executes the actual component source (transpiled with the
 * workspace TypeScript) against a minimal hooks/JSX runtime, then walks the
 * returned element tree to drive props and callbacks the way React would.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test, beforeEach } = require("node:test");
const ts = require("typescript");

/** Minimal React with converging state, ordered effects, and ref objects. */
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
    /** Render to a settled tree; returns the last element. */
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
    /** Render without running effects, so tests can inspect what that very
     * commit published before passive/layout cleanup lands. */
    commit(callback) {
      changed = false; cursor = 0; effects.length = 0;
      const result = callback();
      const pending = effects.splice(0);
      let ran = false;
      return {
        result,
        flush() { if (ran) return; ran = true; pending.forEach((run) => run()); },
      };
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

function transpile(relative) {
  return ts.transpileModule(readFileSync(resolve(__dirname, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function loadComponent(file, mocks) {
  const outputText = transpile(file);
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)((id) => mocks[id] ?? {}, mod, mod.exports);
  return mod.exports;
}

/** Execute an actual local module (not a stub) with the same hook harness. */
function loadSource(file, mocks) {
  const mod = { exports: {} };
  new Function("require", "module", "exports", transpile(file))((id) => {
    if (mocks[id] !== undefined) return mocks[id];
    throw new Error(`unmocked import: ${id} (from ${file})`);
  }, mod, mod.exports);
  return mod.exports;
}

function findNode(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => findNode(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : findNode(node.props?.children, predicate);
}

const FOCUS_DELAY = 120;
const ANCHOR = { x: 40, y: 300, width: 300, height: 56 };

/** The sheet schedules its post-paste focus in a frame; keep frames manual. */
let frames = [];
globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
function flushFrames() {
  const pending = frames;
  frames = [];
  pending.forEach((callback) => callback());
}
async function settleAsync() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
beforeEach(() => { frames = []; });

/* ------------------------------------------------------------------ */
/* FolderPickerMenu                                                    */
/* ------------------------------------------------------------------ */

function pickerHost({ platform = "web" } = {}) {
  const h = reactHarness();
  const spacing = { 2: 2, 4: 4, 8: 8, 12: 12, 16: 16 };
  const mocks = {
    react: h.react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "react-native": { View: "View", Platform: { OS: platform } },
    "../ui/ContextMenu": { ContextMenu: "ContextMenu", ContextMenuItem: "ContextMenuItem" },
    "../ui/Input": { Input: "Input" },
    "../ui/Text": { Text: "Text" },
    "../ui/MaterialIcon": { MaterialIcon: "MaterialIcon" },
    "../ui/ThemedScrollView": { ThemedFlatList: "ThemedFlatList" },
    "../../theme/tokens": { spacing },
  };
  mocks["./use-opening-focus"] = loadSource("../src/components/bookmarks/use-opening-focus.ts", mocks);
  const { FolderPickerMenu } = loadComponent("../src/components/bookmarks/FolderPickerMenu.tsx", mocks);
  const folders = [
    { id: "f1", name: "Recipes", protected: false },
    { id: "f2", name: "Locked diaries", protected: true },
  ];
  const state = { value: "f1", onChange() {}, onDismiss() {}, onCreate() {} };
  const host = {
    h, folders, state,
    render: (visible) => h.render(() => FolderPickerMenu({
      visible, onDismiss: state.onDismiss, folders, value: state.value,
      onChange: state.onChange, onCreate: state.onCreate, anchor: ANCHOR,
    })),
    menu: () => findNode(host.tree, (n) => n.type === "ContextMenu")?.props,
    content: () => findNode(host.tree, (n) => n.type === "View" && Array.isArray(n.props.children))?.props,
    container: () => findNode(host.tree, (n) => n.type === "View" && typeof n.props.onPointerDown === "function")?.props,
    search: () => findNode(host.tree, (n) => n.type === "Input")?.props,
    list: () => findNode(host.tree, (n) => n.type === "ThemedFlatList")?.props,
    wireSearchFocus: () => {
      const ref = host.search().ref;
      ref.current = { focus: () => host.focused.push("search") };
    },
    focused: [],
    tree: null,
  };
  return host;
}

test("picker menu: the search field takes focus once the menu settles", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    assert.deepEqual(host.focused, [], "no focus take before the open settles");
    t.mock.timers.tick(FOCUS_DELAY);
    assert.deepEqual(host.focused, ["search"], "the search input receives focus after the delay");
    // Query edits must not schedule another focus take.
    host.search().onChangeText("Rec");
    host.tree = host.render(true);
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.focused, ["search"], "no refocus while the session stays open");
  } finally {
    t.mock.timers.reset();
  }
});

test("picker menu: a dismissal before the timer cancels the focus take", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    host.tree = host.render(false); // dismissed (scrim, selection, Back) before the delay
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.focused, [], "a dismissed menu must never steal focus");
  } finally {
    t.mock.timers.reset();
  }
});

test("picker menu: quick close/reopen takes focus exactly once, from the new session", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    host.tree = host.render(false);
    host.tree = host.render(true);
    host.wireSearchFocus();
    t.mock.timers.tick(FOCUS_DELAY);
    assert.deepEqual(host.focused, ["search"]);
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.focused, ["search"], "the cancelled first timer must not fire a second take");
  } finally {
    t.mock.timers.reset();
  }
});

test("picker menu: unmount cancels a pending focus take", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    host.h.unmount();
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.focused, []);
  } finally {
    t.mock.timers.reset();
  }
});

test("picker menu: content keeps the search off the menu edges with a Material inset", () => {
  const host = pickerHost();
  host.tree = host.render(true);
  const content = host.content();
  assert.equal(content.style.paddingHorizontal, 16, "16dp Material-rail inset so the search pill cannot touch the menu edges");
  assert.equal(content.style.gap, 8);
  const search = host.search();
  assert.equal(search.variant, "search");
  assert.equal(search.containerStyle.flexShrink, 0, "the search row stays visible when the keyboard clamps the list");
});

test("picker menu: stays an anchored picker that hands the IME to its search", () => {
  const host = pickerHost();
  host.tree = host.render(true);
  const menu = host.menu();
  assert.equal(menu.scrollBody, false, "the picker owns its virtualized list");
  assert.equal(menu.keyboardDismiss, false, "the keyboard is handed to the search field, not dismissed");
  assert.equal(menu.width, ANCHOR.width, "the menu keeps matching its trigger");
  const list = host.list();
  assert.equal(list.keyboardShouldPersistTaps, "handled");
  assert.equal(list.style.flexShrink, 1);
  assert.equal(list.style.maxHeight, 280, "the folder list keeps a bounded, virtualized body");
});

test("picker menu: rows commit the selection and dismiss once", () => {
  const events = [];
  const host = pickerHost();
  host.state.onChange = (id) => events.push(`change:${id}`);
  host.state.onDismiss = () => events.push("dismiss");
  host.state.onCreate = () => events.push("create");
  host.tree = host.render(true);
  const rows = [host.folders[0], host.folders[1]].map((folder) => host.list().renderItem({ item: folder }));
  rows[0].props.onPress();
  assert.deepEqual(events, ["change:f1", "dismiss"]);
  const newFolder = findNode(host.tree, (n) => n.type === "ContextMenuItem" && n.props.label === "New folder");
  newFolder.props.onPress();
  assert.deepEqual(events, ["change:f1", "dismiss", "create"]);
  assert.ok(rows[1].props.trailing, "protected folders keep their lock affordance");
});

test("picker menu: deliberate pointer navigation cancels the delayed take", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousDocument = globalThis.document;
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    assert.ok(host.container(), "the picker content exposes an interaction scope");
    host.container().onPointerDown();
    const row = { tagName: "BUTTON" };
    host.container().ref.current = { contains: (node) => node === row };
    globalThis.document = { activeElement: row };
    host.tree = host.render(true);
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.focused, [], "a row the user really tapped keeps its focus claim");
  } finally {
    globalThis.document = previousDocument;
    t.mock.timers.reset();
  }
});

test("picker menu: a synthesized row focus without input intent still yields to the search", (t) => {
  // On touch, the opening tap's synthesized click can focus the row under the
  // finger with no pointerdown inside the menu. That accidental row focus is
  // not a deliberate navigation and must not suppress the opening take.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousDocument = globalThis.document;
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    const row = { tagName: "BUTTON" };
    assert.ok(host.container()?.ref, "the picker content is the focus scope");
    host.container().ref.current = { contains: (node) => node === row };
    globalThis.document = { activeElement: row };
    t.mock.timers.tick(FOCUS_DELAY);
    assert.deepEqual(host.focused, ["search"], "the search still takes focus from the synthesized row focus");
  } finally {
    globalThis.document = previousDocument;
    t.mock.timers.reset();
  }
});

test("picker menu: real key navigation to a row keeps its focus claim", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousDocument = globalThis.document;
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    assert.ok(host.container(), "the picker content sees the keyboard interaction");
    host.container().onKeyDown();
    const row = { tagName: "BUTTON" };
    host.container().ref.current = { contains: (node) => node === row };
    globalThis.document = { activeElement: row };
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.focused, [], "Tab/Arrow focus chosen by the user wins");
  } finally {
    globalThis.document = previousDocument;
    t.mock.timers.reset();
  }
});

test("picker menu: another editable control already in the menu keeps the keyboard", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousDocument = globalThis.document;
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    host.wireSearchFocus();
    const field = { tagName: "INPUT" };
    host.container().ref.current = { contains: (node) => node === field };
    globalThis.document = { activeElement: field };
    t.mock.timers.tick(FOCUS_DELAY);
    assert.deepEqual(host.focused, [], "an editable field already owning the keyboard is not replaced");
  } finally {
    globalThis.document = previousDocument;
    t.mock.timers.reset();
  }
});

test("picker menu: a field that mounts after the timer gets focus on its first layout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = pickerHost();
    host.tree = host.render(true);
    // The menu is still measuring: the field (and its ref) does not exist yet.
    t.mock.timers.tick(FOCUS_DELAY);
    assert.deepEqual(host.focused, []);
    host.wireSearchFocus();
    assert.ok(host.container(), "the picker content reports its first layout");
    host.container().onLayout();
    assert.deepEqual(host.focused, ["search"], "the pending opening take waits for the real field");
    host.container().onLayout();
    assert.deepEqual(host.focused, ["search"], "a later layout must not take focus again");
  } finally {
    t.mock.timers.reset();
  }
});

/* ------------------------------------------------------------------ */
/* Platform ownership: web manual take, native shared Input scope      */
/* ------------------------------------------------------------------ */

test("picker menu: web keeps the cancellable manual take and disables native autofocus", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = pickerHost({ platform: "web" });
    host.tree = host.render(true);
    host.wireSearchFocus();
    assert.equal(host.search().autoFocus, false, "web never requests native mount autofocus");
    t.mock.timers.tick(FOCUS_DELAY);
    assert.deepEqual(host.focused, ["search"], "the web take still owns opening focus");
  } finally {
    t.mock.timers.reset();
  }
});

test("picker menu: native delegates opening focus to the shared Input scope, not a timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = pickerHost({ platform: "android" });
    host.tree = host.render(true);
    host.wireSearchFocus();
    assert.equal(host.search().autoFocus, true, "native requests focus through the owning overlay's Input scope");
    t.mock.timers.tick(FOCUS_DELAY * 4);
    assert.deepEqual(host.focused, [], "no private 120ms native take may fire");
  } finally {
    t.mock.timers.reset();
  }
});

/* ------------------------------------------------------------------ */
/* AddBookmarkSheet                                                    */
/* ------------------------------------------------------------------ */

function sheetHost({ platform = "web" } = {}) {
  const h = reactHarness();
  const events = [];
  const urlField = {
    focused: false,
    focus() { this.focused = true; events.push("url-focus"); },
    blur() { this.focused = false; events.push("url-blur"); },
    isFocused() { return this.focused; },
  };
  const tagSearch = { focus() { events.push("tag-search-focus"); }, blur() {} };
  const folders = [{ id: "f1", name: "Recipes", protected: false }];
  const clipboard = { text: "", failure: null, deferred: false, resolve: null, reject: null };
  const mutation = { deferred: false, error: null, calls: 0, resolve: null, reject: null };
  const messages = { save: "" };
  const keyboard = { visible: true };
  const tokens = { available: true };
  const spacing = { 2: 2, 4: 4, 6: 6, 8: 8, 12: 12, 16: 16 };
  const mocks = {
    react: h.react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "react-native": { View: "View", StyleSheet: { create: (v) => v }, Platform: { OS: platform }, Keyboard: { isVisible: () => keyboard.visible } },
    "expo-clipboard": {
      getStringAsync: () => {
        if (!clipboard.deferred) return clipboard.failure ? Promise.reject(clipboard.failure) : Promise.resolve(clipboard.text);
        return new Promise((resolve, reject) => {
          clipboard.resolve = () => {
            clipboard.deferred = false;
            clipboard.resolve = clipboard.reject = null;
            resolve(clipboard.text);
          };
          clipboard.reject = () => {
            clipboard.deferred = false;
            clipboard.resolve = clipboard.reject = null;
            reject(clipboard.failure ?? new Error("blocked"));
          };
        });
      },
    },
    "../ui/MaterialIcon": { MaterialIcon: "MaterialIcon" },
    "../../theme/icon-glyph": { iconGlyphStyle: () => undefined },
    "../ui/FloatingPanel": { FloatingPanel: "FloatingPanel" },
    "../ui/PanelHeader": { PanelHeader: "PanelHeader" },
    "../ui/Input": { Input: "Input" },
    "../ui/IconButton": { IconButton: "IconButton" },
    "../../lib/shared-url": { extractSharedUrl: () => null },
    "../ui/Text": { Text: "Text" },
    "../ui/PressableScale": { PressableScale: "PressableScale" },
    "../ui/PickerField": { PickerField: "PickerField" },
    "./FolderPickerMenu": { FolderPickerMenu: "FolderPickerMenu" },
    "../ui/ContextMenu": { ContextMenu: "ContextMenu" },
    "../ui/SheetActionRow": { PanelActions: "PanelActions" },
    "./LockPrompt": { UnlockForm: "UnlockForm" },
    "./CreateFolderPanel": { CreateFolderPanel: "CreateFolderPanel" },
    "../../hooks/use-bookmarks": {
      useCreateBookmark: () => ({
        isPending: false,
        mutateAsync: () => {
          mutation.calls += 1;
          if (!mutation.deferred) return mutation.error ? Promise.reject(mutation.error) : Promise.resolve({});
          return new Promise((resolve, reject) => {
            mutation.resolve = () => {
              mutation.deferred = false;
              mutation.resolve = mutation.reject = null;
              resolve({});
            };
            mutation.reject = () => {
              mutation.deferred = false;
              mutation.resolve = mutation.reject = null;
              reject(mutation.error ?? new Error("save failed"));
            };
          });
        },
      }),
    },
    "../../hooks/queries": { useFolders: () => ({ data: folders }) },
    "../../store/folder-tokens": { useFolderTokenStore: { getState: () => ({ get: () => tokens.available }) } },
    "../../hooks/use-tags": { useTags: () => ({ data: [] }) },
    "../tags/TagSelectList": { TagSelectList: "TagSelectList" },
    "../tags/CreateTagPanel": { CreateTagPanel: "CreateTagPanel" },
    "../../lib/error-message": { errorMessage: () => messages.save, isFolderProtected: () => false },
    "../../lib/haptics": { haptics: { success() {}, error() {}, light() {} } },
    "../../lib/prefetch-extraction": { prefetchExtraction: () => {} },
    "../ui/toast-store": { toast: { success() {}, error() {} } },
    "../../theme/tokens": { spacing, radius: { lg: 16 } },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: {} }) },
    "../../lib/format": { domainFromUrl: () => "" },
    "@ordo/shared": { isSupportedUrl: () => true },
    "../ui/LazyMount": { LazyMount: (props) => props.children() },
  };
  mocks["./use-opening-focus"] = loadSource("../src/components/bookmarks/use-opening-focus.ts", mocks);
  mocks["../../lib/focus-text-input"] = loadSource("../src/lib/focus-text-input.ts", mocks);
  const { AddBookmarkSheet } = loadComponent(process.env.ORDO_SAVE_SHEET_SOURCE
    ?? "../src/components/bookmarks/AddBookmarkSheet.tsx", mocks);
  const base = {
    onDismiss: () => events.push("dismiss"),
    onSaved: (label) => events.push(`saved:${label}`),
    folderId: null,
    allowFolderSelection: true,
  };
  const resolveTree = (overrides) => {
    // Resolve function wrappers (LazyMount -> AddBookmarkContent) inside the
    // render pass so every hook call belongs to a tracked commit.
    let element = AddBookmarkSheet({ ...base, visible: true, ...overrides });
    while (typeof element.type === "function") element = element.type(element.props);
    return element;
  };
  const host = {
    h, events, urlField, tagSearch, base, tree: null, folders, clipboard, mutation, messages, keyboard, tokens,
    render: (overrides) => {
      host.tree = h.render(() => resolveTree(overrides));
      return host.tree;
    },
    /** Inspect a commit before its effects run (the close-gating regression). */
    commit: (overrides) => {
      const commit = h.commit(() => resolveTree(overrides));
      host.tree = commit.result;
      return commit;
    },
    panel: () => findNode(host.tree, (n) => n.type === "FloatingPanel")?.props ?? {},
    field: (label) => findNode(host.tree, (n) => n.type === "PickerField" && n.props.label === label)?.props,
    folderPicker: () => findNode(host.tree, (n) => n.type === "FolderPickerMenu")?.props ?? {},
    createFolderPanel: () => findNode(host.tree, (n) => n.type === "CreateFolderPanel")?.props ?? {},
    createTagPanel: () => findNode(host.tree, (n) => n.type === "CreateTagPanel")?.props ?? {},
    tagMenu: () => findNode(host.tree, (n) => n.type === "View" && typeof n.props.onPointerDown === "function")?.props,
    tagMenuVisible: () => findNode(host.tree, (n) => n.type === "ContextMenu")?.props.visible ?? false,
    actions: () => findNode(host.tree, (n) => n.type === "PanelActions")?.props,
    tagList: () => findNode(host.tree, (n) => n.type === "TagSelectList")?.props ?? {},
    unlock: () => findNode(host.tree, (n) => n.type === "UnlockForm")?.props,
    link: () => findNode(host.tree, (n) => n.type === "Input" && n.props.label === "Link")?.props,
    wireRefs: () => {
      const link = findNode(host.tree, (n) => n.type === "Input" && n.props.label === "Link");
      if (link && !link.props.ref.current) link.props.ref.current = urlField;
      const tags = findNode(host.tree, (n) => n.type === "TagSelectList");
      if (tags && tags.props.searchInputRef && !tags.props.searchInputRef.current) tags.props.searchInputRef.current = tagSearch;
    },
    paste: () => host.link().rightAccessory.props.onPress(),
    editLink: () => findNode(host.tree, (n) => n.type === "PressableScale" && n.props.accessibilityLabel === "Edit link").props.onPress(),
  };
  return host;
}

test("save sheet: opening the folder dropdown releases the link field and suspends the panel", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    host.render({});
    host.wireRefs();
    assert.equal(host.panel().visible, true);
    assert.equal(host.panel().interactive, true, "sheet starts interactive");

    host.field("Folder").onPress(ANCHOR);
    host.render({});
    assert.deepEqual(host.events, ["url-blur"], "the link field's focus is released to the dropdown");
    assert.equal(host.folderPicker().visible, true, "the folder picker opens");
    assert.equal(host.panel().interactive, false, "only the dropdown handles focus/back while open");
    assert.equal(host.panel().obscured, false, "an anchored dropdown does not obscure its parent form");

    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.events, ["url-blur"], "the sheet itself does not refocus anything");
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: the link draft survives the dropdown session", () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.link().onChangeText("https://example.com/a");
  host.render({});
  host.field("Folder").onPress(ANCHOR);
  host.render({});
  assert.equal(host.link().value, "https://example.com/a", "draft text is retained while the picker owns the surface");
  assert.ok(!host.link().disabled, "the field stays enabled, just not focused");
});

test("save sheet: picking a folder updates the field and closes the picker", () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.field("Folder").onPress(ANCHOR);
  host.render({});
  host.folderPicker().onChange("f1");
  host.folderPicker().onDismiss();
  host.render({});
  assert.equal(host.folderPicker().visible, false, "no zombie picker after a selection");
  assert.equal(host.field("Folder").value, "Recipes");
});

test("save sheet: the tag dropdown takes its search focus, and a quick create-tag handoff cancels it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    host.render({});
    host.wireRefs();
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    assert.deepEqual(host.events, ["url-blur"]);
    t.mock.timers.tick(FOCUS_DELAY);
    assert.deepEqual(host.events, ["url-blur", "tag-search-focus"], "the tag search receives focus once the menu settles");

    // Race: reopen, then immediately hand off to the create-tag sibling panel.
    const tagsField = host.field("Tags");
    tagsField.onPress(ANCHOR);
    host.render({});
    host.tagList().onRequestCreateTag(); // close menu + open the create panel
    host.render({});
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.deepEqual(host.events, ["url-blur", "tag-search-focus", "url-blur"],
      "the pending tag-search focus is cancelled by the sibling handoff (the reopen blur is fine)");
    assert.equal(host.panel().obscured, true, "the sibling dialog obscures the save form");
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: the tag dropdown keeps the same 16dp search rail as the folder picker", () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.field("Tags").onPress(ANCHOR);
  host.render({});
  const tagContent = findNode(host.tree, (n) => n.type === "View" && n.props.style?.paddingHorizontal === 16);
  assert.ok(tagContent, "the tag menu content carries the 16dp Material rail");
});

test("save sheet: closing the sheet closes any open dropdown with it", () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.field("Folder").onPress(ANCHOR);
  host.render({});
  assert.equal(host.folderPicker().visible, true);
  host.render({ visible: false });
  host.render({ visible: false });
  assert.equal(host.folderPicker().visible, false, "the dropdown does not outlive its sheet");
});

test("save sheet: a parent close releases child surfaces in that same commit", () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.field("Folder").onPress(ANCHOR);
  host.render({});
  assert.equal(host.folderPicker().visible, true);

  // Close without running effects: this is the commit that used to keep the
  // picker active until the passive reset landed.
  const closing = host.commit({ visible: false });
  assert.equal(host.folderPicker().visible, false, "the folder picker cannot outlive the close commit");
  assert.equal(host.tagMenuVisible(), false, "the tag menu cannot outlive the close commit");
  assert.equal(host.panel().interactive, false);
  closing.flush();
  host.render({ visible: false });
  assert.equal(host.folderPicker().visible, false);
});

test("save sheet: a parent close releases the tag menu and its delayed focus", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    host.render({});
    host.wireRefs();
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    assert.equal(host.tagMenuVisible(), true);

    const closing = host.commit({ visible: false });
    assert.equal(host.tagMenuVisible(), false, "the tag menu is already inactive in the close commit");
    closing.flush();
    host.render({ visible: false });
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.ok(!host.events.includes("tag-search-focus"), "no focus take after the parent closed");
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: reopening with a new initial URL discards a paste from the closed session", async () => {
  const host = sheetHost();
  host.render({ initialUrl: "https://first.example" });
  host.wireRefs();
  assert.equal(host.link().value, "https://first.example");

  host.clipboard.deferred = true;
  host.clipboard.text = "https://stale.example";
  host.paste();
  host.render({ visible: false });
  host.render({ visible: true, initialUrl: "https://second.example" });
  host.wireRefs();
  assert.equal(host.link().value, "https://second.example");

  host.clipboard.resolve();
  await settleAsync();
  host.render({ initialUrl: "https://second.example" });
  assert.equal(host.link().value, "https://second.example", "the closed session's paste cannot overwrite the new URL");
  flushFrames();
  assert.ok(!host.events.includes("url-focus"), "the stale paste never focuses the new session");
});

test("save sheet: typing while the clipboard read is pending wins over the late paste", async () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.clipboard.deferred = true;
  host.clipboard.text = "https://clipboard.example";
  host.paste();

  host.link().onChangeText("https://typed.example");
  host.render({});
  host.clipboard.resolve();
  await settleAsync();
  host.render({});
  assert.equal(host.link().value, "https://typed.example", "the user's edit invalidates the older clipboard read");
  flushFrames();
  assert.ok(!host.events.includes("url-focus"));
});

test("save sheet: a late paste keeps its draft but does not focus a background owner", async () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.clipboard.deferred = true;
  host.clipboard.text = "https://clipboard.example";
  host.paste();

  host.field("Folder").onPress(ANCHOR);
  host.render({});
  assert.equal(host.folderPicker().visible, true);

  host.clipboard.resolve();
  await settleAsync();
  host.render({});
  assert.equal(host.link().value, "https://clipboard.example", "useful clipboard text is still applied to the draft");
  flushFrames();
  assert.ok(!host.events.includes("url-focus"), "the picker keeps focus; the suspended form never takes it back");
});

test("save sheet: a late paste during folder creation stays unfocused too", async () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.clipboard.deferred = true;
  host.clipboard.text = "https://clipboard.example";
  host.paste();

  host.field("Folder").onPress(ANCHOR);
  host.render({});
  host.folderPicker().onCreate();
  host.render({});
  assert.equal(host.createFolderPanel().visible, true);

  host.clipboard.resolve();
  await settleAsync();
  host.render({});
  assert.equal(host.link().value, "https://clipboard.example");
  flushFrames();
  assert.ok(!host.events.includes("url-focus"), "a create panel owns focus, not the background link field");
});

test("save sheet: explicit paste reopens the IME on the Android Back edge", async () => {
  const host = sheetHost({ platform: "android" });
  host.render({});
  host.wireRefs();
  // Android Back hid the IME without clearing TextInputState: the field still
  // reports focused, but ref.focus() alone is a no-op.
  host.urlField.focused = true;
  host.keyboard.visible = false;
  host.clipboard.text = "https://clipboard.example";
  host.paste();
  await settleAsync();
  host.render({});
  flushFrames();

  assert.deepEqual(host.events, ["url-blur", "url-focus"], "only this field is reset, once, then focused");
  assert.equal(host.urlField.focused, true);
});

test("save sheet: a failed clipboard read reports in the form without focusing", async () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.clipboard.deferred = true;
  host.clipboard.failure = new Error("blocked");
  host.paste();

  host.clipboard.reject();
  await settleAsync();
  host.render({});
  assert.match(host.link().error, /Clipboard access is blocked/);
  flushFrames();
  assert.ok(!host.events.includes("url-focus"));
});

test("save sheet: a clipboard failure after close is ignored", async () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.clipboard.deferred = true;
  host.clipboard.failure = new Error("blocked");
  host.paste();

  host.render({ visible: false });
  host.clipboard.reject();
  await settleAsync();
  host.render({ visible: false });
  assert.equal(host.link().error, undefined, "a closed sheet never surfaces a late clipboard error");
  flushFrames();
  assert.ok(!host.events.includes("url-focus"));
});

test("save sheet: a share edit keeps typed text over a stale paste", async () => {
  const host = sheetHost();
  const props = { shareIntake: true, initialUrl: "https://shared.example" };
  host.render(props);
  assert.equal(host.link(), undefined, "the confirmed share link stays a preview until edited");
  host.editLink();
  host.render(props);
  host.wireRefs();
  assert.equal(host.link().autoFocus, true, "entering share edit mounts the field ready for input");

  host.clipboard.deferred = true;
  host.clipboard.text = "https://clipboard.example";
  host.paste();
  host.link().onChangeText("https://edited.example");
  host.render(props);
  host.clipboard.resolve();
  await settleAsync();
  host.render(props);
  assert.equal(host.link().value, "https://edited.example", "the share edit wins over the pending clipboard read");
});

test("save sheet: link autofocus is owner-gated without flapping under a picker", () => {
  const host = sheetHost();
  host.render({});
  assert.equal(host.link().autoFocus, true, "an open sheet mounts its field focused");

  host.field("Folder").onPress(ANCHOR);
  host.render({});
  assert.equal(host.link().autoFocus, true, "a picker session must not flip autoFocus off/on and replay it later");
  assert.equal(host.panel().interactive, false);

  host.render({ visible: false });
  assert.equal(host.link().autoFocus, false, "a closed sheet never replays mount autofocus");
});

test("save sheet: a fresh same-value initialTagIds array does not reset the draft", () => {
  const host = sheetHost();
  const props = { initialTagIds: ["t1", "t2"] };
  host.render(props);
  host.wireRefs();
  host.link().onChangeText("https://draft.example");
  host.tagList().onToggle("t3");
  host.render({ initialTagIds: ["t1", "t2"] });

  assert.equal(host.link().value, "https://draft.example", "same-value array identity is not a reset signal");
  assert.deepEqual(host.tagList().selectedIds, ["t1", "t2", "t3"], "the active tag selection survives a same-value array");

  // Tag selection is a set; a parent that re-derives the same ids in another
  // order is still not a new intent.
  host.render({ initialTagIds: ["t2", "t1"] });
  assert.equal(host.link().value, "https://draft.example");
  assert.deepEqual(host.tagList().selectedIds, ["t1", "t2", "t3"]);
});

test("save sheet: different initialTagIds content is new intent for the tags field only", () => {
  const host = sheetHost();
  host.render({ initialTagIds: ["t1"] });
  host.wireRefs();
  host.link().onChangeText("https://draft.example");
  host.tagList().onToggle("t2");
  host.render({ initialTagIds: ["t1"] });
  host.render({ initialTagIds: ["t3"] });

  assert.deepEqual(host.tagList().selectedIds, ["t3"], "new tag content replaces the tag intent");
  assert.equal(host.link().value, "https://draft.example", "a tag change never clobbers the URL draft");
});

test("save sheet: folder-create handoff cancels the picker and preserves the draft", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    const props = { initialTagIds: ["t1"] };
    host.render(props);
    host.wireRefs();
    host.link().onChangeText("https://draft.example");
    host.field("Folder").onPress(ANCHOR);
    host.render(props);
    host.folderPicker().onCreate();
    host.render(props);

    assert.equal(host.folderPicker().visible, false);
    assert.equal(host.createFolderPanel().visible, true);
    assert.equal(host.link().value, "https://draft.example");
    assert.deepEqual(host.tagList().selectedIds, ["t1"]);
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.ok(!host.events.includes("tag-search-focus"));
    assert.ok(!host.events.includes("url-focus"));

    host.createFolderPanel().onDismiss();
    host.render(props);
    assert.equal(host.createFolderPanel().visible, false);
    assert.equal(host.link().value, "https://draft.example", "cancelling keeps the URL draft");
    assert.deepEqual(host.tagList().selectedIds, ["t1"], "cancelling keeps the selected tags");
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: a created folder becomes the destination without touching the draft", () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.link().onChangeText("https://draft.example");
  host.field("Folder").onPress(ANCHOR);
  host.render({});
  host.folderPicker().onCreate();
  host.render({});

  host.folders.push({ id: "f9", name: "Fresh", protected: false });
  host.createFolderPanel().onCreated({ id: "f9", name: "Fresh", protected: false });
  host.createFolderPanel().onDismiss();
  host.render({});
  assert.equal(host.field("Folder").value, "Fresh");
  assert.equal(host.link().value, "https://draft.example");
  assert.equal(host.panel().interactive, true, "the form resumes after the sibling closes");
});

test("save sheet: tag-create handoff cancels its delayed focus and preserves draft/selection", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    const props = { initialTagIds: ["t1"] };
    host.render(props);
    host.wireRefs();
    host.link().onChangeText("https://draft.example");
    host.field("Tags").onPress(ANCHOR);
    host.render(props);
    assert.equal(host.tagMenuVisible(), true);

    host.tagList().onRequestCreateTag();
    host.render(props);
    assert.equal(host.tagMenuVisible(), false);
    assert.equal(host.createTagPanel().visible, true);
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.ok(!host.events.includes("tag-search-focus"), "the sibling handoff cancels the tag search take");

    host.createTagPanel().onCreated({ id: "t9", name: "New", color: "blue" });
    host.createTagPanel().onDismiss();
    host.render(props);
    assert.equal(host.link().value, "https://draft.example");
    assert.deepEqual(host.tagList().selectedIds, ["t1", "t9"], "the existing selection survives plus the new tag");
    assert.equal(host.createTagPanel().visible, false);
    assert.equal(host.panel().interactive, true);
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: a parent close releases sibling create panels in that same commit", () => {
  const folder = sheetHost();
  folder.render({});
  folder.field("Folder").onPress(ANCHOR);
  folder.render({});
  folder.folderPicker().onCreate();
  folder.render({});
  assert.equal(folder.createFolderPanel().visible, true);
  const folderClosing = folder.commit({ visible: false });
  assert.equal(folder.createFolderPanel().visible, false, "the folder create panel cannot outlive the parent close commit");
  folderClosing.flush();

  const tag = sheetHost();
  tag.render({});
  tag.field("Tags").onPress(ANCHOR);
  tag.render({});
  tag.tagList().onRequestCreateTag();
  tag.render({});
  assert.equal(tag.createTagPanel().visible, true);
  const tagClosing = tag.commit({ visible: false });
  assert.equal(tag.createTagPanel().visible, false, "the tag create panel cannot outlive the parent close commit");
  tagClosing.flush();
});

test("save sheet: tag navigation before the timer keeps its focus claim", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    host.render({});
    host.wireRefs();
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    assert.ok(host.tagMenu(), "the tag content exposes an interaction scope");
    host.tagMenu().onPointerDown();
    host.render({});
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.ok(!host.events.includes("tag-search-focus"));
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: a tag search that mounts after the timer still gets focus on first layout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    host.render({});
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    t.mock.timers.tick(FOCUS_DELAY);
    assert.ok(!host.events.includes("tag-search-focus"), "no target yet");

    host.wireRefs();
    assert.ok(host.tagMenu(), "the tag content reports its first layout");
    host.tagMenu().onLayout();
    assert.deepEqual(host.events.filter((event) => event === "tag-search-focus"), ["tag-search-focus"]);
    host.tagMenu().onLayout();
    assert.equal(host.events.filter((event) => event === "tag-search-focus").length, 1, "the take runs once");
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: a close cancels the tag take and a fresh open takes it exactly once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost();
    host.render({});
    host.wireRefs();
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    host.render({ visible: false });
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.ok(!host.events.includes("tag-search-focus"), "closed before the timer: no take");

    host.render({ visible: true });
    host.wireRefs();
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    t.mock.timers.tick(FOCUS_DELAY);
    assert.equal(host.events.filter((event) => event === "tag-search-focus").length, 1, "the reopened picker takes focus once");
    t.mock.timers.tick(FOCUS_DELAY * 2);
    assert.equal(host.events.filter((event) => event === "tag-search-focus").length, 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: web tag picker keeps the manual take and leaves native autofocus off", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost({ platform: "web" });
    host.render({});
    host.wireRefs();
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    assert.equal(host.tagList().searchAutoFocus, false, "web owns focus through the cancellable take");
    t.mock.timers.tick(FOCUS_DELAY);
    assert.equal(host.events.filter((event) => event === "tag-search-focus").length, 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: native tag picker delegates to the Input scope and runs no timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = sheetHost({ platform: "android" });
    host.render({});
    host.wireRefs();
    assert.equal(host.link().autoFocus, true, "the field keeps its logical autoFocus intent");
    host.field("Tags").onPress(ANCHOR);
    host.render({});
    assert.equal(host.tagList().searchAutoFocus, true, "native opening focus flows through the ContextMenu Input scope");
    t.mock.timers.tick(FOCUS_DELAY * 4);
    assert.ok(!host.events.includes("tag-search-focus"), "no private native opening timer may fire");
  } finally {
    t.mock.timers.reset();
  }
});

test("save sheet: a successful share save resets the draft and hands off", async () => {
  const host = sheetHost();
  const props = { shareIntake: true, initialUrl: "https://shared.example", initialTagIds: ["t1"] };
  host.render(props);
  host.actions().onConfirm();
  await settleAsync();
  host.render(props);

  assert.deepEqual(host.events, ["saved:Bookmarks"], "share intake hands off instead of dismissing");
  assert.equal(host.link().value, "");
  assert.equal(host.field("Folder").value, "Bookmarks");
  assert.deepEqual(host.tagList().selectedIds, ["t1"], "the next intake starts from its own initial tags");
});

/* ------------------------------------------------------------------ */
/* TagSelectList: additive native opening-focus opt-in                 */
/* ------------------------------------------------------------------ */

function tagListHost() {
  const h = reactHarness();
  const spacing = { 2: 2, 4: 4, 8: 8, 12: 12, 16: 16 };
  const mocks = {
    react: h.react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "react-native": { View: "View", StyleSheet: { create: (value) => value }, Keyboard: { dismiss() {} }, Platform: { OS: "android" } },
    "../ui/ThemedScrollView": { ThemedFlatList: "ThemedFlatList" },
    "../ui/MaterialIcon": { MaterialIcon: "MaterialIcon" },
    "../ui/Text": { Text: "Text" },
    "../ui/Input": { Input: "Input" },
    "../ui/PressableScale": { PressableScale: "PressableScale" },
    "../ui/ContextMenu": { ContextMenuItem: "ContextMenuItem" },
    "../../hooks/use-tags": {
      useTags: () => ({ data: [] }),
      useCreateTag: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: {} }) },
    "../../theme/tokens": { radius: { sm: 8, full: 999 }, spacing },
    "../../lib/tag-colors": { tagColorValue: () => ({ dot: "#000" }) },
    "../../hooks/use-responsive-layout": { useResponsiveLayout: () => ({ height: 800 }) },
    "../ui/toast-store": { toast: { error() {}, success() {} } },
    "../../lib/error-message": { errorMessage: () => "" },
    "@ordo/shared": {},
  };
  const { TagSelectList } = loadComponent("../src/components/tags/TagSelectList.tsx", mocks);
  const host = {
    h, tree: null,
    render: (props) => {
      host.tree = h.render(() => TagSelectList({ selectedIds: [], onToggle() {}, menu: true, ...props }));
      return host.tree;
    },
    search: () => findNode(host.tree, (node) => node.type === "Input")?.props,
  };
  return host;
}

test("tag select list: searchAutoFocus forwards the host's opening intent and stays opt-in", () => {
  const host = tagListHost();
  host.render({});
  assert.equal(host.search().autoFocus, undefined, "callers that do not opt in keep mount behavior unchanged");

  host.render({ searchAutoFocus: true });
  assert.equal(host.search().autoFocus, true, "native pickers request focus through the Input scope");

  host.render({ searchAutoFocus: false });
  assert.equal(host.search().autoFocus, false, "web pickers keep their own cancellable take");
});

/* ------------------------------------------------------------------ */
/* Save settlement belongs to the session that started it              */
/* ------------------------------------------------------------------ */

test("save sheet: a save resolving after close/reopen leaves the new session untouched", async () => {
  const host = sheetHost();
  const first = { initialUrl: "https://first.example" };
  host.render(first);
  host.wireRefs();
  host.mutation.deferred = true;
  host.actions().onConfirm();
  assert.equal(host.mutation.calls, 1, "the request starts in the first session");

  host.render({ ...first, visible: false });
  host.render({ initialUrl: "https://second.example" });
  host.wireRefs();
  assert.equal(host.link().value, "https://second.example");

  host.mutation.resolve();
  await settleAsync();
  host.render({ initialUrl: "https://second.example" });

  assert.equal(host.link().value, "https://second.example", "the old success cannot reset the reopened draft");
  assert.equal(host.mutation.calls, 1, "the cache mutation itself still completed");
  assert.deepEqual(host.events, [], "no dismiss, toast, or handoff from the stale session");
  flushFrames();
  assert.ok(!host.events.includes("url-focus"));
});

test("save sheet: a stale share success never calls the new intake's onSaved", async () => {
  const host = sheetHost();
  const first = { shareIntake: true, initialUrl: "https://first.example" };
  host.render(first);
  host.mutation.deferred = true;
  host.actions().onConfirm();

  host.render({ ...first, visible: false });
  host.render({ shareIntake: true, initialUrl: "https://second.example" });
  host.mutation.resolve();
  await settleAsync();
  host.render({ shareIntake: true, initialUrl: "https://second.example" });

  assert.deepEqual(host.events, [], "the reopened intake is not handed off or reset by the old save");
  assert.equal(host.link(), undefined, "the second share still shows its own preview, not a reset blank field");
  flushFrames();
  assert.ok(!host.events.includes("url-focus"));
});

test("save sheet: a save failure after close/reopen cannot report in the new draft", async () => {
  const host = sheetHost();
  host.messages.save = "Network down.";
  host.mutation.error = new Error("save failed");
  const first = { initialUrl: "https://first.example" };
  host.render(first);
  host.mutation.deferred = true;
  host.actions().onConfirm();

  host.render({ ...first, visible: false });
  host.render({ initialUrl: "https://second.example" });
  host.mutation.reject();
  await settleAsync();
  host.render({ initialUrl: "https://second.example" });

  assert.equal(host.link().error, undefined, "the old failure never surfaces on the new draft");
  assert.equal(host.link().value, "https://second.example");
  assert.deepEqual(host.events, []);
  flushFrames();
  assert.ok(!host.events.includes("url-focus"));
});

test("save sheet: a new intake URL while visible invalidates an in-flight settlement", async () => {
  const host = sheetHost();
  host.render({ shareIntake: true, initialUrl: "https://first.example" });
  host.mutation.deferred = true;
  host.actions().onConfirm();

  host.render({ shareIntake: true, initialUrl: "https://second.example" });
  host.mutation.resolve();
  await settleAsync();
  host.render({ shareIntake: true, initialUrl: "https://second.example" });

  assert.deepEqual(host.events, [], "the previous intake's save cannot hand off the new link");
  assert.equal(host.link(), undefined, "the new link keeps its preview");
});

test("save sheet: a same-session success still dismisses once", async () => {
  const host = sheetHost();
  host.render({ initialUrl: "https://saved.example" });
  host.actions().onConfirm();
  await settleAsync();
  host.render({ initialUrl: "https://saved.example" });
  assert.deepEqual(host.events, ["dismiss"]);
});

test("save sheet: a same-session failure still reports once", async () => {
  const host = sheetHost();
  host.messages.save = "Network down.";
  host.mutation.error = new Error("save failed");
  host.render({ initialUrl: "https://failed.example" });
  host.actions().onConfirm();
  await settleAsync();
  host.render({ initialUrl: "https://failed.example" });
  assert.equal(host.link().error, "Network down.");
  assert.deepEqual(host.events, []);
});

/* ------------------------------------------------------------------ */
/* Save-owned child callbacks belong to their rendered session         */
/* ------------------------------------------------------------------ */

test("save sheet: a stale folder-create onCreated cannot attach to a reopened draft", () => {
  const host = sheetHost();
  const first = { initialUrl: "https://first.example" };
  host.render(first);
  host.wireRefs();
  host.field("Folder").onPress(ANCHOR);
  host.render(first);
  host.folderPicker().onCreate();
  host.render(first);
  const staleCreated = host.createFolderPanel().onCreated;

  host.render({ ...first, visible: false });
  const second = { initialUrl: "https://second.example" };
  host.render(second);
  host.wireRefs();
  host.field("Folder").onPress(ANCHOR);
  host.render(second);
  host.folderPicker().onCreate();
  host.render(second);

  host.folders.push({ id: "old", name: "Old folder", protected: false });
  staleCreated({ id: "old", name: "Old folder", protected: false });
  host.render(second);
  assert.equal(host.field("Folder").value, "Bookmarks", "the old created folder is not attached to the new draft");

  host.folders.push({ id: "fresh", name: "Fresh folder", protected: false });
  const current = host.createFolderPanel();
  current.onCreated({ id: "fresh", name: "Fresh folder", protected: false });
  current.onDismiss();
  host.render(second);
  assert.equal(host.field("Folder").value, "Fresh folder", "current callbacks still batch normally");
  assert.equal(host.createFolderPanel().visible, false);
});

test("save sheet: a stale folder-create onDismiss cannot close the new child", () => {
  const host = sheetHost();
  const first = { initialUrl: "https://first.example" };
  host.render(first);
  host.field("Folder").onPress(ANCHOR);
  host.render(first);
  host.folderPicker().onCreate();
  host.render(first);
  const staleDismiss = host.createFolderPanel().onDismiss;

  host.render({ ...first, visible: false });
  const second = { initialUrl: "https://second.example" };
  host.render(second);
  host.field("Folder").onPress(ANCHOR);
  host.render(second);
  host.folderPicker().onCreate();
  host.render(second);
  assert.equal(host.createFolderPanel().visible, true);

  staleDismiss();
  host.render(second);
  assert.equal(host.createFolderPanel().visible, true, "the old dismiss cannot close the new child");
});

test("save sheet: a stale tag-create onCreated cannot attach to a reopened draft", () => {
  const host = sheetHost();
  const first = { initialUrl: "https://first.example", initialTagIds: ["t1"] };
  host.render(first);
  host.wireRefs();
  host.field("Tags").onPress(ANCHOR);
  host.render(first);
  host.tagList().onRequestCreateTag();
  host.render(first);
  const staleCreated = host.createTagPanel().onCreated;

  host.render({ ...first, visible: false });
  const second = { initialUrl: "https://second.example", initialTagIds: ["t1"] };
  host.render(second);
  host.wireRefs();
  host.field("Tags").onPress(ANCHOR);
  host.render(second);
  host.tagList().onRequestCreateTag();
  host.render(second);

  staleCreated({ id: "old", name: "Old", color: "blue" });
  host.render(second);
  assert.deepEqual(host.tagList().selectedIds, ["t1"], "the old created tag is not attached to the new draft");

  const current = host.createTagPanel();
  current.onCreated({ id: "t9", name: "New", color: "blue" });
  current.onDismiss();
  host.render(second);
  assert.deepEqual(host.tagList().selectedIds, ["t1", "t9"], "current callbacks still batch normally");
  assert.equal(host.createTagPanel().visible, false);
});

test("save sheet: a stale tag-create onDismiss cannot close the new child", () => {
  const host = sheetHost();
  const first = { initialUrl: "https://first.example", initialTagIds: ["t1"] };
  host.render(first);
  host.field("Tags").onPress(ANCHOR);
  host.render(first);
  host.tagList().onRequestCreateTag();
  host.render(first);
  const staleDismiss = host.createTagPanel().onDismiss;

  host.render({ ...first, visible: false });
  const second = { initialUrl: "https://second.example", initialTagIds: ["t1"] };
  host.render(second);
  host.field("Tags").onPress(ANCHOR);
  host.render(second);
  host.tagList().onRequestCreateTag();
  host.render(second);
  assert.equal(host.createTagPanel().visible, true);

  staleDismiss();
  host.render(second);
  assert.equal(host.createTagPanel().visible, true, "the old dismiss cannot close the new tag child");
});

test("save sheet: a stale unlock onUnlocked cannot submit the old URL", () => {
  const host = sheetHost();
  host.folders[0].protected = true;
  host.tokens.available = false;
  const first = { initialUrl: "https://first.example", folderId: "f1" };
  host.render(first);
  host.actions().onConfirm();
  host.render(first);
  assert.ok(host.unlock(), "the protected save opens the unlock form");
  const staleUnlocked = host.unlock().onUnlocked;

  host.tokens.available = true;
  host.render({ ...first, visible: false });
  const second = { initialUrl: "https://second.example", folderId: null };
  host.render(second);
  host.wireRefs();
  assert.equal(host.link().value, "https://second.example");

  staleUnlocked();
  host.render(second);
  assert.equal(host.mutation.calls, 0, "the stale unlock never submits the old URL");
  assert.equal(host.link().value, "https://second.example");
  assert.equal(host.unlock(), undefined);
});

test("save sheet: a stale unlock onCancel cannot close the new unlock form", () => {
  const host = sheetHost();
  host.folders[0].protected = true;
  host.tokens.available = false;
  const first = { initialUrl: "https://first.example", folderId: "f1" };
  host.render(first);
  host.actions().onConfirm();
  host.render(first);
  const staleUnlocked = host.unlock().onUnlocked;
  const staleCancel = host.unlock().onCancel;

  host.render({ ...first, visible: false });
  const second = { initialUrl: "https://second.example", folderId: "f1" };
  host.render(second);
  host.actions().onConfirm();
  host.render(second);
  assert.ok(host.unlock(), "the new session opens its own unlock form");

  staleCancel();
  host.render(second);
  assert.ok(host.unlock(), "the old cancel cannot close the new unlock form");
  staleUnlocked();
  host.render(second);
  assert.equal(host.mutation.calls, 0, "the old unlock still cannot submit the new session");
});

test("save sheet: a current unlock callback still submits the current draft", async () => {
  const host = sheetHost();
  host.folders[0].protected = true;
  host.tokens.available = false;
  const props = { initialUrl: "https://current.example", folderId: "f1" };
  host.render(props);
  host.actions().onConfirm();
  host.render(props);
  const unlock = host.unlock();
  assert.ok(unlock);

  host.tokens.available = true;
  host.mutation.deferred = true;
  unlock.onUnlocked();
  host.render(props);
  assert.equal(host.mutation.calls, 1, "the live unlock may continue submitting its own draft");

  host.mutation.resolve();
  await settleAsync();
  host.render(props);
  assert.deepEqual(host.events, ["dismiss"]);
});

test("save sheet: a late unlock callback after cancel cannot submit the old URL", () => {
  const host = sheetHost();
  host.folders[0].protected = true;
  host.tokens.available = false;
  const props = { initialUrl: "https://first.example", folderId: "f1" };
  host.render(props);
  host.actions().onConfirm();
  host.render(props);
  assert.ok(host.unlock());
  const lateUnlocked = host.unlock().onUnlocked;
  host.unlock().onCancel();
  host.render(props);
  assert.equal(host.unlock(), undefined, "the same-session cancel returned to the form");

  // The unlock succeeded after the user backed out: never submit it.
  host.tokens.available = true;
  lateUnlocked();
  host.render(props);
  assert.equal(host.mutation.calls, 0);
  assert.equal(host.link().value, "https://first.example");
});

test("save sheet: a clipboard read settling after unmount does nothing", async () => {
  const host = sheetHost();
  host.render({});
  host.wireRefs();
  host.clipboard.deferred = true;
  host.clipboard.text = "https://late.example";
  host.paste();

  host.h.unmount();
  host.clipboard.resolve();
  await settleAsync();
  flushFrames();
  assert.ok(!host.events.includes("url-focus"), "no focus into an unmounted route");
});
