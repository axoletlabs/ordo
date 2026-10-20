/** Run with: node --test apps/mobile/scripts/action-sheet-prep.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const zustand = require("zustand");

// Transpile the real store module (only dependency is zustand) so the test
// tracks the shipped source instead of a copy.
function load(filename) {
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  const localRequire = (name) => (name === "zustand" ? zustand : require(name));
  new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
  return mod.exports;
}

const { useActionSheetPrepStore, selectActionSheetPrep, prepActionSheets } =
  load(resolve(__dirname, "../src/hooks/use-action-sheet-prep.ts"));

test("prep marks only the requested target sheet", () => {
  prepActionSheets("editTags");
  assert.equal(selectActionSheetPrep("editTags")(useActionSheetPrepStore.getState()), true);
  assert.equal(selectActionSheetPrep("move")(useActionSheetPrepStore.getState()), false);
  prepActionSheets("move");
  assert.equal(selectActionSheetPrep("move")(useActionSheetPrepStore.getState()), true);
});

test("prep is sticky across later menu sessions (dismiss never unprepares)", () => {
  prepActionSheets("editTags");
  prepActionSheets("editTags");
  // A closed menu, a cancelled handoff, and repeated presses must not drop
  // the flag: a warm sheet unmounting mid-handoff would reintroduce the
  // post-exit mount pause this store exists to remove.
  assert.equal(selectActionSheetPrep("editTags")(useActionSheetPrepStore.getState()), true);
});

test("repeated prep calls notify subscribers only once", () => {
  let notifications = 0;
  let latest = selectActionSheetPrep("addTags")(useActionSheetPrepStore.getState());
  const unsubscribe = useActionSheetPrepStore.subscribe((state) => {
    notifications += 1;
    latest = selectActionSheetPrep("addTags")(state);
  });
  prepActionSheets("addTags");
  const firstBatch = notifications;
  prepActionSheets("addTags");
  prepActionSheets("addTags");
  unsubscribe();
  assert.equal(firstBatch, 1, "first mark notifies prepared sheets once");
  assert.equal(notifications, 1, "same-value prep must not re-render warm sheets");
  assert.equal(latest, true);
});

test("selectors return booleans so reference equality cannot cause renders", () => {
  for (const target of ["editTags", "move", "addTags"]) {
    for (const state of [{ prepped: {} }, { prepped: { [target]: true } }]) {
      assert.equal(typeof selectActionSheetPrep(target)(state), "boolean");
    }
  }
});

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
    "../../hooks/use-action-sheet-prep": { prepActionSheets },
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
