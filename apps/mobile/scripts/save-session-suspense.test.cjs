/** Run with: node --test apps/mobile/scripts/save-session-suspense.test.cjs
 *
 * Real React update/suspension coverage for the Save sheet's applied-session
 * token and for the web opening-focus take's committed ownership. A discarded
 * concurrent render must not invent a close or a new intake URL, and must not
 * cancel a take that still belongs to the live picker. An in-flight save still
 * belongs to the live committed session and must settle normally; a real
 * committed close/reopen still invalidates it.
 *
 * AddBookmarkSheet.tsx is executed as the actual transpiled source against a
 * small real-React component surface; the suspension is thrown by the mocked
 * FloatingPanel child so the discarded render runs the sheet's own session
 * logic before React abandons it. use-opening-focus.ts is executed directly.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

function transpile(path) {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

const SHEET_SOURCE = () => process.env.ORDO_SAVE_SHEET_SOURCE
  ?? resolve(__dirname, "../src/components/bookmarks/AddBookmarkSheet.tsx");

function loadSheet() {
  // TypeScript's CommonJS default-import interop reads `react.default`.
  if (!React.default) React.default = React;
  const pending = {
    mutation: null,
    dismissals: 0,
    saved: 0,
    toasts: { success: 0, error: 0 },
    haptics: { success: 0, error: 0 },
    suspended: false,
    suspend: false,
  };
  const hang = new Promise(() => {});
  const Fragment = React.Fragment;
  const Children = (props) => React.createElement(Fragment, null, props.children);
  const Null = () => null;
  const PanelActions = (props) => React.createElement("button", {
    type: "button",
    "data-confirm": "true",
    onClick: () => props.onConfirm(),
  }, props.confirmLabel);
  const Input = React.forwardRef(function Input(props, ref) {
    return React.createElement("input", {
      "data-label": props.label,
      readOnly: true,
      value: props.value ?? "",
      ref,
    });
  });
  const FloatingPanel = (props) => {
    if (pending.suspend) {
      pending.suspended = true;
      throw hang;
    }
    return React.createElement("div", null, props.children);
  };
  const View = (props) => React.createElement("div", null, props.children);
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { View, StyleSheet: { create: (value) => value }, Platform: { OS: "web" }, Keyboard: { isVisible: () => true } },
    "expo-clipboard": { getStringAsync: async () => "" },
    "../ui/MaterialIcon": { MaterialIcon: Null },
    "../../theme/icon-glyph": { iconGlyphStyle: () => undefined },
    "../ui/FloatingPanel": { FloatingPanel },
    "../ui/PanelHeader": { PanelHeader: Null },
    "../ui/Input": { Input },
    "../ui/IconButton": { IconButton: Null },
    "../../lib/shared-url": { extractSharedUrl: () => null },
    "../ui/Text": { Text: (props) => React.createElement("span", null, props.children) },
    "../ui/PressableScale": { PressableScale: Children },
    "../ui/PickerField": { PickerField: Null },
    "./FolderPickerMenu": { FolderPickerMenu: Null },
    "../ui/ContextMenu": { ContextMenu: Null },
    "../ui/SheetActionRow": { PanelActions },
    "./LockPrompt": { UnlockForm: Null },
    "./CreateFolderPanel": { CreateFolderPanel: Null },
    "../../hooks/use-bookmarks": {
      useCreateBookmark: () => ({
        isPending: false,
        mutateAsync: () => new Promise((resolve, reject) => { pending.mutation = { resolve, reject }; }),
      }),
    },
    "../../hooks/queries": { useFolders: () => ({ data: [] }) },
    "../../store/folder-tokens": { useFolderTokenStore: { getState: () => ({ get: () => true }) } },
    "../../hooks/use-tags": { useTags: () => ({ data: [] }) },
    "../tags/TagSelectList": { TagSelectList: Null },
    "../tags/CreateTagPanel": { CreateTagPanel: Null },
    "../../lib/error-message": { errorMessage: () => "Save failed.", isFolderProtected: () => false },
    "../../lib/haptics": { haptics: { success() { pending.haptics.success += 1; }, error() { pending.haptics.error += 1; }, light() {} } },
    "../../lib/prefetch-extraction": { prefetchExtraction: () => {} },
    "../ui/toast-store": { toast: { success() { pending.toasts.success += 1; }, error() { pending.toasts.error += 1; } } },
    "../../theme/tokens": { spacing: { 2: 2, 4: 4, 6: 6, 8: 8, 12: 12, 16: 16 }, radius: { lg: 16 } },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: {} }) },
    "../../lib/format": { domainFromUrl: () => "" },
    "../../lib/focus-text-input": { focusTextInput() {} },
    "@ordo/shared": { isSupportedUrl: () => true },
    "../ui/LazyMount": { LazyMount: (props) => props.children() },
    "./use-opening-focus": { useOpeningFocus: () => ({ onPointerDown() {}, onKeyDown() {}, onLayout() {} }) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", transpile(SHEET_SOURCE()))((id) => {
    if (mocks[id] !== undefined) return mocks[id];
    throw new Error(`unmocked import: ${id}`);
  }, module, module.exports);
  return { AddBookmarkSheet: module.exports.AddBookmarkSheet, pending };
}

function setupDom() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    dom,
    restore() {
      dom.window.close();
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    },
  };
}

function mount(AddBookmarkSheet, pending, { strict = false } = {}) {
  const root = createRoot(globalThis.document.getElementById("root"));
  const sheet = (visible, initialUrl) => React.createElement(AddBookmarkSheet, {
    visible,
    initialUrl,
    folderId: null,
    allowFolderSelection: true,
    onDismiss: () => { pending.dismissals += 1; },
    onSaved: () => { pending.saved += 1; },
  });
  const live = (visible, initialUrl) => React.createElement(React.Suspense, { fallback: React.createElement("div", null, "loading") },
    sheet(visible, initialUrl));
  return {
    root,
    render: (visible, initialUrl) => strict
      // StrictMode must enclose the Suspense boundary to replay mount effects.
      ? React.createElement(React.StrictMode, null, live(visible, initialUrl))
      : live(visible, initialUrl),
    confirm: () => globalThis.document.querySelector("[data-confirm]"),
    url: () => globalThis.document.querySelector('input[data-label="Link"]')?.value,
  };
}

async function startSave(host) {
  await React.act(async () => host.confirm().click());
}

test("an aborted close cannot suppress the live save settlement", async () => {
  const env = setupDom();
  let host;
  try {
    const { AddBookmarkSheet, pending } = loadSheet();
    host = mount(AddBookmarkSheet, pending);
    await React.act(async () => host.root.render(host.render(true, "https://first.example")));
    await startSave(host);
    assert.ok(pending.mutation, "the save request started");

    pending.suspend = true;
    await React.act(async () => {
      React.startTransition(() => host.root.render(host.render(false, "https://first.example")));
    });
    assert.equal(pending.suspended, true, "the close render suspended and was discarded");
    assert.ok(host.confirm(), "the live sheet never closed");

    await React.act(async () => pending.mutation.resolve({}));
    assert.equal(pending.dismissals, 1, "the still-committed session settles and dismisses normally");
  } finally {
    if (host) await React.act(async () => host.root.unmount());
    env.restore();
  }
});

test("an aborted new intake URL cannot suppress the live save settlement", async () => {
  const env = setupDom();
  let host;
  try {
    const { AddBookmarkSheet, pending } = loadSheet();
    host = mount(AddBookmarkSheet, pending);
    await React.act(async () => host.root.render(host.render(true, "https://first.example")));
    await startSave(host);

    pending.suspend = true;
    await React.act(async () => {
      React.startTransition(() => host.root.render(host.render(true, "https://second.example")));
    });
    assert.equal(pending.suspended, true);
    assert.equal(host.url(), "https://first.example", "the live intake URL did not change");

    await React.act(async () => pending.mutation.resolve({}));
    assert.equal(pending.dismissals, 1, "the save still belongs to the committed first intake");
  } finally {
    if (host) await React.act(async () => host.root.unmount());
    env.restore();
  }
});

test("a real committed close/reopen still invalidates the in-flight save", async () => {
  const env = setupDom();
  let host;
  try {
    const { AddBookmarkSheet, pending } = loadSheet();
    host = mount(AddBookmarkSheet, pending);
    await React.act(async () => host.root.render(host.render(true, "https://first.example")));
    await startSave(host);

    await React.act(async () => host.root.render(host.render(false, "https://first.example")));
    await React.act(async () => host.root.render(host.render(true, "https://second.example")));
    assert.equal(host.url(), "https://second.example");

    await React.act(async () => pending.mutation.resolve({}));
    assert.equal(pending.dismissals, 0, "the old save must not dismiss the reopened session");
    assert.equal(host.url(), "https://second.example", "the old success must not reset the new draft");
  } finally {
    if (host) await React.act(async () => host.root.unmount());
    env.restore();
  }
});

function loadOpeningFocus() {
  if (!React.default) React.default = React;
  const source = process.env.ORDO_OPENING_FOCUS_SOURCE
    ?? resolve(__dirname, "../src/components/bookmarks/use-opening-focus.ts");
  const module = { exports: {} };
  new Function("require", "module", "exports", transpile(source))((id) => {
    if (id === "react") return React;
    if (id === "react-native") return { Platform: { OS: "web" } };
    throw new Error(`unmocked import: ${id}`);
  }, module, module.exports);
  return module.exports.useOpeningFocus;
}

test("a discarded close cannot cancel the live web opening take", async () => {
  const env = setupDom();
  let root;
  try {
    const useOpeningFocus = loadOpeningFocus();
    const hang = new Promise(() => {});
    let suspended = false;
    let focuses = 0;
    function Harness({ active, suspend }) {
      const target = React.useRef({ focus: () => { focuses += 1; } });
      useOpeningFocus({ active, targetRef: target });
      if (suspend) {
        suspended = true;
        throw hang;
      }
      return React.createElement("div");
    }
    const view = (active, suspend) => React.createElement(React.Suspense, { fallback: "loading" },
      React.createElement(Harness, { active, suspend }));
    root = createRoot(globalThis.document.getElementById("root"));

    await React.act(async () => root.render(view(true, false)));
    // The live picker owns a pending 120ms take. Start a transition that
    // renders active=false but suspends before committing; React keeps the
    // live tree, so that take must still belong to it.
    await React.act(async () => {
      React.startTransition(() => root.render(view(false, true)));
    });
    assert.equal(suspended, true);
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
    assert.equal(focuses, 1, "the discarded close must not cancel the live take");
  } finally {
    if (root) await React.act(async () => root.unmount());
    env.restore();
  }
});

test("a save resolving after unmount has no UI side effects", async () => {
  const env = setupDom();
  let host;
  try {
    const { AddBookmarkSheet, pending } = loadSheet();
    host = mount(AddBookmarkSheet, pending);
    await React.act(async () => host.root.render(host.render(true, "https://first.example")));
    await startSave(host);
    assert.ok(pending.mutation);

    await React.act(async () => host.root.unmount());
    host = null;
    await React.act(async () => pending.mutation.resolve({}));

    assert.equal(pending.dismissals, 0, "no onDismiss into the unmounted route");
    assert.equal(pending.saved, 0, "no share handoff");
    assert.equal(pending.toasts.success, 0);
    assert.equal(pending.haptics.success, 0);
  } finally {
    if (host) await React.act(async () => host.root.unmount());
    env.restore();
  }
});

test("a save rejecting after unmount has no UI side effects", async () => {
  const env = setupDom();
  let host;
  try {
    const { AddBookmarkSheet, pending } = loadSheet();
    host = mount(AddBookmarkSheet, pending);
    await React.act(async () => host.root.render(host.render(true, "https://first.example")));
    await startSave(host);

    await React.act(async () => host.root.unmount());
    host = null;
    await React.act(async () => pending.mutation.reject(new Error("offline")));

    assert.equal(pending.haptics.error, 0, "no error haptic for an unmounted sheet");
    assert.equal(pending.dismissals, 0);
    assert.equal(pending.saved, 0);
  } finally {
    if (host) await React.act(async () => host.root.unmount());
    env.restore();
  }
});

test("StrictMode effect replay keeps the live save session active", async () => {
  const env = setupDom();
  let host;
  try {
    const { AddBookmarkSheet, pending } = loadSheet();
    host = mount(AddBookmarkSheet, pending, { strict: true });
    await React.act(async () => host.root.render(host.render(true, "https://first.example")));
    await startSave(host);
    await React.act(async () => pending.mutation.resolve({}));

    assert.equal(pending.dismissals, 1, "the replayed cleanup must not leave the live sheet inactive");
    assert.equal(pending.toasts.success, 1);
    assert.equal(pending.haptics.success, 1);
  } finally {
    if (host) await React.act(async () => host.root.unmount());
    env.restore();
  }
});
