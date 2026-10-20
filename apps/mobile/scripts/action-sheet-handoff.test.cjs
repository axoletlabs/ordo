/** Run with: node --test apps/mobile/scripts/action-sheet-handoff.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function handoffHost() {
  const slots = [];
  let cursor = 0;
  const react = {
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo: fn => fn(),
    useLayoutEffect(fn, deps) {
      const index = cursor++;
      if (slots[index] && deps.every((value, i) => Object.is(value, slots[index][i]))) return;
      slots[index] = deps; fn();
    },
  };
  react.default = react;
  const mocks = {
    react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "../../hooks/use-app-router": { useAppRouter: () => ({}) },
    "../ui/ContextMenu": { ContextMenu: "ContextMenu", ContextMenuItem: "ContextMenuItem" },
    "../ui/ConfirmDialog": { ConfirmDialog: "ConfirmDialog" },
    "../../lib/bookmark-reader": { bookmarkIsArticle: () => false, bookmarkCanBeArticle: () => false },
    "../../hooks/use-selection": { bookmarkKey: id => id },
    "../../hooks/use-menu-highlight": { useMenuHighlight() {} },
    "../../lib/overlay-session-mode": { useOverlaySessionMode: (_visible, initial) => [initial, () => {}] },
    "../../hooks/queries": { useServerInfo: () => ({ data: { reminders: false } }) },
    "./ReminderFlow": { useSaveReminder: () => ({ save() {}, busy: false }) },
  };
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src/components/bookmarks/BookmarkActionsSheet.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => mocks[name] ?? {}, mod, mod.exports);
  return props => { cursor = 0; return mod.exports.BookmarkActionsSheet(props); };
}

function editorHost() {
  const slots = [];
  let cursor = 0;
  const react = {
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect() {}, useMemo: fn => fn(),
  };
  react.default = react;
  const mocks = {
    react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "react-native": { StyleSheet: { create: value => value } },
    "../ui/FloatingPanel": { FloatingPanel: "FloatingPanel" },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: {} }) },
    "../../hooks/use-tags": { useUpdateBookmarkTags: () => ({}) },
    "../../theme/tokens": { spacing: {} },
  };
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src/components/tags/EditTagsSheet.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => mocks[name] ?? {}, mod, mod.exports);
  return props => { cursor = 0; return mod.exports.EditTagsSheet(props); };
}

test("editor retention is local to the screen actually opened", () => {
  const first = editorHost(), unopened = editorHost();
  const props = { visible: false, onDismiss() {}, bookmark: { id: "article", tags: [], suggestedTags: [] } };
  const panel = tree => findNode(tree, node => node.type === "FloatingPanel");
  assert.equal(panel(first(props)).props.keepMounted, false);
  assert.equal(panel(first({ ...props, visible: true })).props.keepMounted, true);
  assert.equal(panel(first({ ...props, bookmark: null })).props.keepMounted, true, "retain its own exit/warm surface");
  assert.equal(panel(unopened(props)).props.keepMounted, false, "never mount a different screen's unopened editor");
});

test("an unused empty editor creates no surface", () => {
  assert.equal(editorHost()({ visible: false, bookmark: null, onDismiss() {} }), null);
});

function findNode(node, predicate) {
  if (Array.isArray(node)) return node.map(child => findNode(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : findNode(node.props?.children, predicate);
}

for (const [label, callback] of [["Edit tags", "onEditTags"], ["Move to folder", "onMove"]]) {
  test(`${label} opens at exit start, not after the menu fade`, () => {
    const render = handoffHost(), events = [];
    const bookmark = { id: "article", isRead: false, remindAt: null };
    const props = { visible: true, bookmark, anchor: null, onDismiss: () => events.push("dismiss"),
      [callback]: row => events.push(`open:${row.id}`) };
    const opened = render(props);
    findNode(opened, node => node.type === "ContextMenuItem" && node.props.label === label).props.onPress();
    assert.deepEqual(events, ["dismiss"]);
    const closing = render({ ...props, visible: false, bookmark: null });
    const menu = findNode(closing, node => node.type === "ContextMenu");
    assert.equal(menu.props.onExited, undefined, "the handoff must not wait for the completed fade");
    menu.props.onExiting();
    menu.props.onExiting();
    assert.deepEqual(events, ["dismiss", "open:article"], "handoff runs exactly once with retained bookmark data");
  });
}
