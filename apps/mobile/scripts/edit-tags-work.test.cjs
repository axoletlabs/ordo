/** Real React + actual EditTagsSheet source: initialize a new draft before its
 * controls commit, rather than mounting the picker twice from a passive reset. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const commits = [], saved = [];
  const iconButtons = new Map();
  let picker, panel, createPanel, actions;
  let saveError;
  const host = ({ children }) => React.createElement("div", null, children);
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { View: host, ScrollView: host, StyleSheet: { create: value => value } },
    "../ui/MaterialIcon": { MaterialIcon: () => null },
    "../ui/FloatingPanel": { FloatingPanel: props => { panel = props; return props.visible ? props.children : null; } },
    "../ui/PanelHeader": { PanelHeader: () => null },
    "../ui/SheetActionRow": { PanelActions: props => { actions = props; return null; } },
    "../ui/Text": { Text: host },
    "../ui/IconButton": { IconButton: props => { iconButtons.set(props.accessibilityLabel, props); return null; } },
    "./TagChip": { TagChip: () => null },
    "./TagSelectList": { TagSelectList: props => {
      picker = props;
      React.useLayoutEffect(() => { commits.push([...props.selectedIds]); });
      return props.header;
    } },
    "./CreateTagPanel": { CreateTagPanel: props => { createPanel = props; return null; } },
    "../../hooks/use-tags": { useUpdateBookmarkTags: () => ({ mutateAsync: async value => {
      if (saveError) throw saveError;
      saved.push(value);
    } }) },
    "../../lib/error-message": { errorMessage: error => error.message },
    "../../lib/haptics": { haptics: { selection() {}, light() {}, success() {}, error() {} } },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: {} }) },
    "../../theme/tokens": { spacing: {} },
  };
  const file = resolve(process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src"), "components/tags/EditTagsSheet.tsx");
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, mod, mod.exports);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const dismissed = [];
  const onDismiss = () => dismissed.push(true);
  return {
    commits, saved, dismissed, iconButtons,
    get text() { return container.textContent; },
    failSave: error => { saveError = error; },
    get picker() { return picker; }, get panel() { return panel; },
    get createPanel() { return createPanel; }, get actions() { return actions; },
    render: props => React.act(async () => root.render(React.createElement(mod.exports.EditTagsSheet, { onDismiss, ...props }))),
    dispose: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}
const bookmark = { id: "a", folderId: "folder-a", tags: [{ id: "design", name: "Design", color: "blue" }], suggestedTags: [] };

test("first open and reopen commit only the initialized tag picker", async () => {
  const view = mount();
  try {
    await view.render({ visible: false, bookmark: null });
    await view.render({ visible: true, bookmark });
    assert.deepEqual(view.commits, [["design"]], "no empty draft is committed before the assigned tags");
    await React.act(async () => view.picker.onToggle("new"));
    await view.render({ visible: false, bookmark: null });
    view.commits.length = 0;
    await view.render({ visible: true, bookmark });
    assert.deepEqual(view.commits, [["design"]], "reopen must not commit the discarded draft and then reset it");
    assert.equal(view.panel.keepMounted, undefined, "do not retain hidden picker trees as a performance shortcut");
  } finally { await view.dispose(); }
});

test("edits and child tag creation survive parent renders and save the current draft", async () => {
  const view = mount();
  try {
    await view.render({ visible: true, bookmark });
    await React.act(async () => view.picker.onToggle("design"));
    await React.act(async () => view.picker.onToggle("extra"));
    await view.render({ visible: true, bookmark });
    assert.deepEqual(view.picker.selectedIds, ["extra"]);
    await React.act(async () => view.picker.onRequestCreateTag());
    assert.equal(view.panel.obscured, true);
    await React.act(async () => view.createPanel.onCreated({ id: "created" }));
    await React.act(async () => view.createPanel.onDismiss());
    assert.equal(view.panel.obscured, false);
    assert.deepEqual(view.picker.selectedIds, ["extra", "created"]);
    await React.act(async () => view.actions.onConfirm());
    assert.deepEqual(view.saved, [{ id: "a", tagIds: ["extra", "created"], dismissedSuggestionIds: [], folderId: "folder-a" }]);
    assert.equal(view.dismissed.length, 1);
  } finally { await view.dispose(); }
});

test("replacing the visible bookmark resets the draft in one control commit", async () => {
  const view = mount();
  try {
    await view.render({ visible: true, bookmark });
    await React.act(async () => view.picker.onToggle("unsaved"));
    view.commits.length = 0;
    const next = { ...bookmark, id: "b", tags: [{ id: "reading", name: "Reading", color: "blue" }] };
    await view.render({ visible: true, bookmark: next });
    assert.deepEqual(view.commits, [["reading"]]);
  } finally { await view.dispose(); }
});

test("reopen clears suggestion dismissals, child visibility and save errors before the picker commits", async () => {
  const view = mount();
  const suggested = { ...bookmark, suggestedTags: [{ id: "suggested", name: "Suggested tag", color: "blue" }] };
  try {
    await view.render({ visible: true, bookmark: suggested });
    assert.ok(view.text.includes("Suggested"));
    await React.act(async () => view.iconButtons.get("Dismiss suggested tag Suggested tag").onPress());
    assert.equal(view.text.includes("Suggested"), false);
    view.failSave(new Error("Save failed"));
    await React.act(async () => view.actions.onConfirm());
    assert.ok(view.text.includes("Save failed"));
    await React.act(async () => view.picker.onRequestCreateTag());
    assert.equal(view.createPanel.visible, true);
    await view.render({ visible: false, bookmark: null });
    view.commits.length = 0;
    await view.render({ visible: true, bookmark: suggested });
    assert.deepEqual(view.commits, [["design"]]);
    assert.equal(view.createPanel.visible, false);
    assert.equal(view.panel.obscured, false);
    assert.equal(view.text.includes("Save failed"), false);
    assert.ok(view.text.includes("Suggested"), "a new session restores dismissed suggestions");
  } finally { await view.dispose(); }
});
