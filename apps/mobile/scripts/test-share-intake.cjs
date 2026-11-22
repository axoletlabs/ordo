/** Exercise the real parsers, share handler, and save-form callbacks with
 * controlled clipboard/network promises. No browser or live account needed. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createStore } = require("zustand/vanilla");

function load(file, mocks = {}, suffix = "") {
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8") + suffix;
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  vm.runInNewContext(outputText, {
    exports: exported, URL, Set, JSON, console, setTimeout, clearTimeout,
    requestAnimationFrame: callback => { callback(); return 1; },
    require: name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith("../ui/")) return new Proxy({}, { get: (_, key) => key });
      return require(name);
    },
  });
  return exported;
}
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const urls = load("lib/shared-url.ts");
const intake = load("lib/share-intake.ts");
const drafts = load("lib/bookmark-drafts.ts");

const samples = [
  ["Read https://one.example/a and https://two.example/b", ["https://one.example/a", "https://two.example/b"]],
  ["https://one.example,https://two.example;https://three.example", ["https://one.example/", "https://two.example/", "https://three.example/"]],
  ["https://ONE.example:443/ https://one.example# https://one.example/?q=2", ["https://one.example/", "https://one.example/?q=2"]],
  ["[Read](https://one.example/wiki/Thing_(detail)). <https://two.example/a?x=1&y=2#part>", ["https://one.example/wiki/Thing_(detail)", "https://two.example/a?x=1&y=2#part"]],
  ["https://one.example/?next=https://two.example/a", ["https://one.example/?next=https://two.example/a"]],
  ["bad https:// https://?x ftp://one.example then https://two.example", ["https://two.example/"]],
  ["no links", []],
];
for (const [text, expected] of samples) assert.deepEqual(plain(urls.extractSharedUrls(null, text)), expected, text);
assert.deepEqual(plain(urls.extractSharedUrls("https://one.example/wiki/Thing_", "https://one.example/wiki/Thing_(detail) https://two.example")),
  ["https://one.example/wiki/Thing_(detail)", "https://two.example/"], "ignore the share library's truncated webUrl hint");
assert.deepEqual(plain(urls.extractSharedUrls("https://one.example", "Title only")), ["https://one.example/"]);
for (const raw of ["", "null", "false", "{}", "broken"]) assert.equal(intake.parseQuickShareHandoff(raw).review, false);
assert.equal(intake.parseQuickShareHandoff("1").fromQuickTarget, true, "old APK flags remain compatible");
assert.equal(intake.parseQuickShareHandoff('{"review":true,"savedCount":2}').savedCount, 2);
assert.equal(intake.parseQuickShareHandoff('{"savedCount":-1}').savedCount, 0);
assert.equal(intake.shareSavedToast("Reading", 3), "3 bookmarks saved to Reading");

let nextId = 20;
const original = [{ id: 7, url: "old.example" }, { id: 8, url: "keep.example", error: "keep me" }];
const pasted = drafts.pasteBookmarkDrafts(original, 7, ["https://one.example/", "https://keep.example/", "https://two.example/", "https://one.example/"], () => nextId++);
assert.deepEqual(plain(pasted), [{ id: 7, url: "https://one.example/" }, { id: 20, url: "https://two.example/" }, original[1]]);
assert.equal(pasted.at(-1), original[1], "untouched drafts keep identity and validation");
assert.equal(original[0].url, "old.example", "paste does not mutate existing drafts");
assert.equal(drafts.pasteBookmarkDrafts(original, 999, ["https://one.example"], () => nextId++), original);

// A small hook scheduler lets us run the components' actual effects and
// callbacks while deciding exactly when async work resolves.
function hooks() {
  const slots = [];
  let cursor = 0, dirty = false, Component, props, output;
  let layouts = [], effects = [];
  const changed = (before, after) => !before || !after || after.some((value, index) => !Object.is(value, before[index]));
  const effect = queue => (callback, dependencies) => {
    const index = cursor++;
    const previous = slots[index];
    if (changed(previous?.dependencies, dependencies)) {
      slots[index] = { dependencies, cleanup: previous?.cleanup };
      queue.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
    }
  };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useMemo(callback, dependencies) {
      const index = cursor++;
      if (changed(slots[index]?.dependencies, dependencies)) slots[index] = { dependencies, value: callback() };
      return slots[index].value;
    },
    useEffect: (callback, dependencies) => effect(effects)(callback, dependencies),
    useLayoutEffect: (callback, dependencies) => effect(layouts)(callback, dependencies),
  };
  return { react,
    render(component = Component, nextProps = props) {
      Component = component; props = nextProps;
      do {
        dirty = false; cursor = 0; layouts = []; effects = [];
        output = Component(props);
        layouts.forEach(callback => callback());
        effects.forEach(callback => callback());
      } while (dirty);
      return output;
    },
  };
}

function shareHarness({ quick = false, handoff, save } = {}) {
  const runner = hooks();
  const stateListeners = [];
  const { useIncomingShareStore: store } = load("store/incoming-share.ts", {
    "react-native": { Platform: { OS: "android" }, useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }), AppState: { currentState: "active", addEventListener: (_, callback) => stateListeners.push(callback) } },
    "../lib/share-intake": intake,
    zustand: { create: initialize => {
      const api = createStore(initialize);
      return Object.assign(selector => selector(api.getState()), api);
    } },
  });
  const received = [], returned = [], errors = [], prefetched = [];
  const context = { hasShareIntent: true, shareIntent: { text: "https://one.example https://two.example https://three.example" }, resetShareIntent() {}, error: null };
  const { IncomingShareHandler } = load("components/IncomingShareHandler.tsx", {
    react: runner.react,
    "expo-share-intent": { useShareIntentContext: () => context },
    "../store/incoming-share": { useIncomingShareStore: store },
    "../store/auth": { useAuthStore: { getState: () => ({ status: "authenticated" }) } },
    "../store/settings": { useSettingsStore: { getState: () => ({ shareQuickBookmark: quick, shareShowQuickAction: false }) } },
    "../lib/share-intake": intake, "../lib/shared-url": urls,
    "../lib/share-targets": { consumeQuickShareHandoff: () => handoff ?? Promise.resolve(intake.parseQuickShareHandoff("")) },
    "../lib/share-target": { returnToShareSender: message => returned.push(message), saveUnfiledBookmark: async url => { received.push(url); await save?.(url); } },
    "../lib/prefetch-extraction": { prefetchExtraction: url => prefetched.push(url) },
    "../lib/error-message": { errorMessage: error => error.message },
    "../lib/haptics": { haptics: { success() {} } },
    "./ui/toast-store": { toast: { error: message => errors.push(message) } },
  });
  return { runner, store, context, received, returned, errors, prefetched,
    render: () => runner.render(IncomingShareHandler), background: () => stateListeners.forEach(callback => callback("background")) };
}

/** The sheet always allocates its in-place create forms, even while they are
 * not the visible page. Real ones own query hooks, so give them inert fields. */
function emptyCreateForm(kind) {
  return {
    name: "", setName() {}, error: "", submit() {}, busy: false,
    ...(kind === "folder" ? { icon: "folder-outline", setIcon() {} } : { color: "blue", setColor() {} }),
  };
}

function formHarness({ autoPaste = false, clipboard = Promise.resolve(""), save = async () => {}, initialUrls, allowFolderSelection = false } = {}) {
  const runner = hooks();
  const writes = [], notices = [];
  const create = { mutateAsync: async value => { writes.push(value); await save(value); } };
  const { Content } = load("components/bookmarks/AddBookmarkSheet.tsx", {
    react: runner.react,
    "react-native": { Platform: { OS: "android" }, StyleSheet: { create: value => value }, View: "View", useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }) },
    "expo-clipboard": { hasStringAsync: async () => true, getStringAsync: () => clipboard },
    "../../lib/shared-url": urls, "../../lib/bookmark-drafts": drafts,
    "../../hooks/use-bookmarks": { useCreateBookmark: () => create },
    "../../hooks/queries": { useFolders: () => ({ data: [] }) },
    "../../hooks/use-tags": { useTags: () => ({ data: [] }) },
    "../../store/settings": { useSettingsStore: { getState: () => ({ autoPasteClipboardLink: autoPaste }) } },
    "../../store/folder-tokens": { useFolderTokenStore: { getState: () => ({ get: () => true }) } },
    "../../lib/error-message": { errorMessage: error => error.message, isFolderProtected: () => false },
    "../../lib/haptics": { haptics: { success() {}, error() {} } },
    "../../lib/prefetch-extraction": { prefetchExtraction() {} },
    "../../lib/focus-text-input": { focusTextInput() {} },
    "../../hooks/use-keyboard-visible": { dismissKeyboard() {} },
    "../../theme/tokens": { spacing: {} },
    "../ui/toast-store": { toast: { success: message => notices.push(message) } },
    "../ui/draft-dismiss": { DraftDismissContext: { Provider: "DraftProvider" } },
    "./LockPrompt": { UnlockForm: "UnlockForm" },
    "./FolderIconPicker": { FolderIconPicker: "FolderIconPicker" },
    "./FolderSelectPage": { FolderSelectPage: "FolderSelectPage" },
    // Stand-in for the link group: the layout and its fields stay inert
    // elements; the harness drives the sheet through the shared actions the
    // real field would invoke (change, paste, remove).
    "./BookmarkLinkField": {
      BookmarkLinkLayout: "BookmarkLinkLayout",
      BookmarkLinkField: "BookmarkLinkField",
      useBookmarkLinkActions: actions => actions,
    },
    "./CreateFolderPanel": { useCreateFolderForm: () => emptyCreateForm("folder") },
    "../tags/TagSelectList": { TagSelectList: "TagSelectList" },
    "../tags/TagColorPicker": { TagColorPicker: "TagColorPicker" },
    "../tags/CreateTagPanel": { useCreateTagForm: () => emptyCreateForm("tag") },
  }, "\nexport { AddBookmarkContent as Content };");
  const props = { visible: true, folderId: null, initialUrls, allowFolderSelection, onDismiss() {} };
  const find = (tree, type) => {
    if (!tree) return null;
    if (Array.isArray(tree)) return tree.map(child => find(child, type)).find(Boolean);
    // BookmarkLinkLayout carries the link fields beside children.
    if (tree.props?.fields) { const hit = find(tree.props.fields, type); if (hit) return hit; }
    return tree.type === type ? tree : find(tree.props?.children, type);
  };
  const findAll = (tree, type) => {
    if (!tree) return [];
    if (Array.isArray(tree)) return tree.flatMap(child => findAll(child, type));
    const self = tree.type === type ? [tree] : [];
    // BookmarkLinkLayout carries the link fields beside children.
    const fromFields = tree.props?.fields ? tree.props.fields.flatMap(child => findAll(child, type)) : [];
    return [...self, ...fromFields, ...findAll(tree.props?.children, type)];
  };
  return { runner, props, writes, notices, render() {
    const tree = runner.render(Content, props);
    // Each link is one BookmarkLinkField carrying its draft and the shared
    // actions the real field invokes.
    const fields = findAll(tree, "BookmarkLinkField");
    return {
      node: type => find(tree, type),
      nodes: type => findAll(tree, type),
      fields,
      urls: fields.map(field => field.props.draft.url),
      change: (index, text) => fields[index].props.actions.onChange(fields[index].props.draft.id, text),
      paste: index => fields[index].props.actions.onPaste(fields[index].props.draft.id),
      confirm: find(tree, "PanelActions")?.props.onConfirm,
    };
  } };
}

(async () => {
  const sheet = shareHarness(); sheet.render(); await tick();
  assert.equal(sheet.store.getState().pendingUrls.length, 3);
  assert.equal(sheet.received.length, 0, "normal sharing opens drafts without saving");
  const quick = shareHarness({ quick: true }); quick.render(); await tick();
  assert.equal(quick.received.length, 3);
  assert.equal(quick.returned[0], "3 bookmarks saved to Bookmarks");
  const fail = shareHarness({ quick: true, save: async url => { if (url.includes("two")) throw Error("Offline"); } });
  fail.render(); await tick();
  assert.deepEqual(plain(fail.store.getState().pendingUrls), ["https://two.example/", "https://three.example/"]);
  assert.equal(fail.returned.length, 0, "failed batches remain reviewable");
  const review = shareHarness({ quick: true, handoff: Promise.resolve({ review: true, savedCount: 2 }) });
  review.render(); await tick();
  assert.equal(review.received.length, 0, "native fallback must not immediately retry Quick Save");
  assert.equal(review.store.getState().pendingUrls.length, 3);
  const pending = deferred(), cancelled = shareHarness({ handoff: pending.promise });
  cancelled.render(); cancelled.background(); pending.resolve({}); await tick();
  assert.equal(cancelled.store.getState().pendingUrls.length, 0, "leaving the app cancels a delayed intake");
  const network = deferred(), interrupted = shareHarness({ quick: true, save: () => network.promise });
  interrupted.render(); await tick(); interrupted.background(); network.resolve(); await tick();
  assert.equal(interrupted.received.length, 1, "a cancelled intake stops before the next write");
  assert.equal(interrupted.returned.length, 0, "a stale batch must not dismiss the current app");
  const duplicates = shareHarness({ quick: true }); duplicates.render(); duplicates.render(); await tick();
  assert.equal(duplicates.received.length, 3, "effect replay must not save a batch twice");
  duplicates.context.shareIntent = { ...duplicates.context.shareIntent }; duplicates.render(); await tick();
  assert.equal(duplicates.received.length, 6, "a new share of the same links is still an intake");

  const auto = formHarness({ autoPaste: true, clipboard: Promise.resolve("https://one.example https://two.example") });
  auto.render(); await tick();
  assert.equal(auto.render().urls.length, 2, "auto-paste creates one field per link");
  const late = deferred(), typed = formHarness({ autoPaste: true, clipboard: late.promise });
  typed.render().change(0, "my-edit.example");
  late.resolve("https://one.example https://two.example"); await tick();
  assert.equal(typed.render().urls[0], "my-edit.example", "late clipboard reads preserve typed edits");
  const shared = formHarness({ autoPaste: true, initialUrls: ["https://shared.example"], clipboard: Promise.resolve("https://one.example https://two.example") });
  shared.render(); await tick();
  assert.equal(shared.render().urls[0], "https://shared.example", "explicit intake beats clipboard");
  const keyboard = formHarness();
  keyboard.render().change(0, "https://one.example https://two.example https://one.example");
  assert.equal(keyboard.render().urls.length, 2, "native keyboard paste splits and deduplicates");
  const nested = "https://one.example/?next=https://two.example/a?";
  keyboard.render().change(0, nested);
  assert.equal(keyboard.render().urls[0], nested, "typing a nested URL must not rewrite the field");
  const paste = formHarness({ initialUrls: ["https://old.example", "https://keep.example"], clipboard: Promise.resolve("https://one.example https://two.example") });
  paste.render().paste(0); await tick();
  assert.deepEqual(plain(paste.render().urls), ["https://one.example/", "https://two.example/", "https://keep.example"]);
  const navigation = formHarness({ allowFolderSelection: true });
  navigation.render().change(0, "https://draft.example");
  navigation.render().nodes("PickerField").find(field => field.props.label === "Folder").props.onPress();
  navigation.render().node("FolderSelectPage").props.onCreate();
  navigation.render().node("PanelHeader").props.leading.props.onPress();
  assert.ok(navigation.render().node("FolderSelectPage"), "New folder Back returns to folder selection");
  assert.equal(navigation.render().node("FloatingPanel").props.onDismissAttempt(), true, "Android Back stays inside the save surface");
  assert.equal(navigation.render().urls[0], "https://draft.example", "folder navigation preserves the draft");
  navigation.render().nodes("PickerField").find(field => field.props.label === "Tags").props.onPress();
  const pendingTagSelection = navigation.render().node("TagSelectList").props.onToggle;
  pendingTagSelection("tag-one");
  navigation.render().node("TagSelectList").props.onRequestCreateTag();
  navigation.render().node("FloatingPanel").props.onDismissAttempt();
  assert.deepEqual(plain(navigation.render().node("TagSelectList").props.selectedIds), ["tag-one"], "New tag Back returns to selected tags");
  navigation.render().confirm();
  assert.equal(navigation.render().urls[0], "https://draft.example", "tag navigation preserves the draft");
  pendingTagSelection("late-tag");
  navigation.render().nodes("PickerField").find(field => field.props.label === "Tags").props.onPress();
  assert.deepEqual(plain(navigation.render().node("TagSelectList").props.selectedIds), ["tag-one"], "a late inline create cannot select a tag after leaving the picker");
  navigation.props.visible = false;
  navigation.render();
  navigation.props.visible = true;
  navigation.render().nodes("PickerField").find(field => field.props.label === "Tags").props.onPress();
  pendingTagSelection("old-session-tag");
  assert.deepEqual(plain(navigation.render().node("TagSelectList").props.selectedIds), [], "a late inline create cannot select a tag in a reopened save flow");
  let offline = true;
  const saving = formHarness({ initialUrls: ["https://one.example", "https://two.example", "https://three.example"],
    save: async value => { if (offline && value.url.includes("two")) throw Error("Offline"); } });
  saving.render().confirm(); await tick();
  assert.deepEqual(plain(saving.render().urls), ["https://two.example", "https://three.example"]);
  offline = false; saving.render().confirm(); await tick();
  assert.equal(saving.writes.filter(value => value.url.includes("one")).length, 1, "retry does not resave successful links");
  for (const [file, hook] of [
    ["components/bookmarks/CreateFolderPanel.tsx", "useCreateFolderForm"],
    ["components/tags/CreateTagPanel.tsx", "useCreateTagForm"],
  ]) {
    const runner = hooks(), writes = [], created = [];
    let createNetwork = deferred();
    // Keep isPending false until a render: two submissions can arrive before
    // React Query publishes its pending state to the component.
    const mutation = { isPending: false, mutateAsync: value => {
      writes.push(value);
      return createNetwork.promise;
    } };
    const module = load(file, {
      react: runner.react,
      "react-native": { StyleSheet: { create: value => value }, View: "View" },
      "../../hooks/use-folders": { useCreateFolder: () => mutation },
      "../../hooks/use-tags": { useCreateTag: () => mutation },
      "../../lib/haptics": { haptics: { success() {}, error() {} } },
      "../../lib/error-message": { errorMessage: error => error.message },
      "../../theme/tokens": { spacing: {} },
      "./FolderIconPicker": { FolderIconPicker: "FolderIconPicker" },
      "./TagColorPicker": { TagColorPicker: "TagColorPicker" },
    });
    const renderForm = () => runner.render(() => module[hook](true, value => created.push(value)));
    renderForm().setName("Audit fixture");
    const form = renderForm();
    const first = form.submit(), second = form.submit();
    assert.equal(writes.length, 1, `${hook}: rapid Create submits once`);
    createNetwork.reject(Error("Offline"));
    await Promise.all([first, second]);
    assert.equal(renderForm().name, "Audit fixture", `${hook}: failure retains the name`);
    createNetwork = deferred();
    const retry = renderForm().submit();
    assert.equal(writes.length, 2, `${hook}: retry sends one fresh request`);
    createNetwork.resolve({ id: "fixture" });
    await retry;
    assert.equal(created.length, 1, `${hook}: success settles once`);
  }
  {
    const runner = hooks(), writes = [], selected = [];
    let network = deferred();
    const { TagSelectList } = load("components/tags/TagSelectList.tsx", {
      react: runner.react,
      "react-native": { StyleSheet: { create: value => value }, View: "View", Keyboard: { dismiss() {} } },
      "../../hooks/use-tags": {
        useTags: () => ({ data: [] }),
        useCreateTag: () => ({ isPending: false, mutateAsync: value => { writes.push(value); return network.promise; } }),
      },
      "../../theme/ThemeProvider": { useTheme: () => ({ palette: {}, expressive: false }) },
      "../../theme/tokens": { spacing: {}, radius: {} },
      "../../hooks/use-responsive-layout": { useResponsiveLayout: () => ({ height: 844 }) },
      "../../lib/tag-colors": { tagColorValue: () => ({ dot: "teal" }) },
      "../../lib/error-message": { errorMessage: error => error.message },
      "../../theme/list-shape": { listCorners() {}, listPosition() {} },
      "../ui/toast-store": { toast: { error() {} } },
    });
    const render = () => runner.render(TagSelectList, { selectedIds: [], onToggle: id => selected.push(id) });
    render().props.children[0].props.onChangeText("Inline audit");
    const row = render().props.children[1].props.ListFooterComponent;
    row.props.onPress(); row.props.onPress();
    assert.equal(writes.length, 1, "inline tag creation submits once before pending state renders");
    network.reject(Error("Offline")); await tick();
    assert.equal(render().props.children[0].props.value, "Inline audit", "inline tag failure retains the search text");
    network = deferred();
    render().props.children[1].props.ListFooterComponent.props.onPress();
    assert.equal(writes.length, 2, "inline tag retry sends one fresh request");
    network.resolve({ id: "inline-tag" }); await tick();
    assert.deepEqual(selected, ["inline-tag"], "inline tag success selects once");
    assert.equal(render().props.children[0].props.value, "", "inline tag success clears its query");
  }
  console.log("PASS: multi-link extraction, share intake, native fallback review, cancellation, auto-paste, keyboard paste, draft preservation, partial-save retries and rapid folder/tag/inline creation");
})().catch(error => { console.error(error); process.exitCode = 1; });
