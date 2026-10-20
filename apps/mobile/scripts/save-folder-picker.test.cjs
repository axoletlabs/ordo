/** Run with: node --test apps/mobile/scripts/save-folder-picker.test.cjs
 *
 * Regression tests for the Save bookmark -> folder/tag picker flow:
 * - components/bookmarks/FolderPickerMenu.tsx: search-field focus handoff
 *   (delayed take, cancelled on dismissal/reopen races), Material content
 *   inset (the search pill must not touch the menu edges), anchored width,
 *   IME handoff intent, virtualized list ownership, row callbacks.
 * - components/bookmarks/AddBookmarkSheet.tsx: the suspended save form
 *   releases the link field's focus when a dropdown opens, keeps its draft
 *   while the picker owns the surface, obscures only for sibling dialogs,
 *   and hands the tag search focus only while the tag menu is the surface.
 *
 * The harness executes the actual component source (transpiled with the
 * workspace TypeScript) against a minimal hooks/JSX runtime, then walks the
 * returned element tree to drive props and callbacks the way React would.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
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

function findNode(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => findNode(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : findNode(node.props?.children, predicate);
}

const FOCUS_DELAY = 120;
const ANCHOR = { x: 40, y: 300, width: 300, height: 56 };

/* ------------------------------------------------------------------ */
/* FolderPickerMenu                                                    */
/* ------------------------------------------------------------------ */

function pickerHost() {
  const h = reactHarness();
  const spacing = { 2: 2, 4: 4, 8: 8, 12: 12, 16: 16 };
  const mocks = {
    react: h.react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "react-native": { View: "View", Platform: { OS: "web" } },
    "../ui/ContextMenu": { ContextMenu: "ContextMenu", ContextMenuItem: "ContextMenuItem" },
    "../ui/Input": { Input: "Input" },
    "../ui/Text": { Text: "Text" },
    "../ui/MaterialIcon": { MaterialIcon: "MaterialIcon" },
    "../ui/ThemedScrollView": { ThemedFlatList: "ThemedFlatList" },
    "../../theme/tokens": { spacing },
  };
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

/* ------------------------------------------------------------------ */
/* AddBookmarkSheet                                                    */
/* ------------------------------------------------------------------ */

function sheetHost() {
  const h = reactHarness();
  const events = [];
  const urlField = { focus() {}, blur() { events.push("url-blur"); } };
  const tagSearch = { focus() { events.push("tag-search-focus"); }, blur() {} };
  const spacing = { 2: 2, 4: 4, 6: 6, 8: 8, 12: 12, 16: 16 };
  const mocks = {
    react: h.react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "react-native": { View: "View", StyleSheet: { create: (v) => v }, Platform: { OS: "web" } },
    "expo-clipboard": { getStringAsync: async () => "" },
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
    "../../hooks/use-bookmarks": { useCreateBookmark: () => ({ isPending: false, mutateAsync: async () => ({}) }) },
    "../../hooks/queries": { useFolders: () => ({ data: [{ id: "f1", name: "Recipes", protected: false }] }) },
    "../../store/folder-tokens": { useFolderTokenStore: { getState: () => ({ get: () => true }) } },
    "../../hooks/use-tags": { useTags: () => ({ data: [] }) },
    "../tags/TagSelectList": { TagSelectList: "TagSelectList" },
    "../tags/CreateTagPanel": { CreateTagPanel: "CreateTagPanel" },
    "../../lib/error-message": { errorMessage: () => "", isFolderProtected: () => false },
    "../../lib/haptics": { haptics: { success() {}, error() {}, light() {} } },
    "../../lib/prefetch-extraction": { prefetchExtraction: () => {} },
    "../ui/toast-store": { toast: { success() {}, error() {} } },
    "../../theme/tokens": { spacing, radius: { lg: 16 } },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: {} }) },
    "../../lib/format": { domainFromUrl: () => "" },
    "@ordo/shared": { isSupportedUrl: () => true },
    "../ui/LazyMount": { LazyMount: (props) => props.children() },
  };
  const { AddBookmarkSheet } = loadComponent("../src/components/bookmarks/AddBookmarkSheet.tsx", mocks);
  const base = { onDismiss: () => events.push("dismiss"), folderId: null, allowFolderSelection: true };
  const host = {
    h, events, urlField, tagSearch, base, tree: null,
    render: (overrides) => {
      // Resolve function wrappers (LazyMount -> AddBookmarkContent) inside the
      // render pass so every hook call belongs to a tracked commit.
      host.tree = h.render(() => {
        let element = AddBookmarkSheet({ ...base, visible: true, ...overrides });
        while (typeof element.type === "function") element = element.type(element.props);
        return element;
      });
      return host.tree;
    },
    panel: () => findNode(host.tree, (n) => n.type === "FloatingPanel")?.props ?? {},
    field: (label) => findNode(host.tree, (n) => n.type === "PickerField" && n.props.label === label)?.props,
    folderPicker: () => findNode(host.tree, (n) => n.type === "FolderPickerMenu")?.props ?? {},
    tagList: () => findNode(host.tree, (n) => n.type === "TagSelectList")?.props ?? {},
    link: () => findNode(host.tree, (n) => n.type === "Input" && n.props.label === "Link")?.props,
    wireRefs: () => {
      const link = findNode(host.tree, (n) => n.type === "Input" && n.props.label === "Link");
      if (link && !link.props.ref.current) link.props.ref.current = urlField;
      const tags = findNode(host.tree, (n) => n.type === "TagSelectList");
      if (tags && tags.props.searchInputRef && !tags.props.searchInputRef.current) tags.props.searchInputRef.current = tagSearch;
    },
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
