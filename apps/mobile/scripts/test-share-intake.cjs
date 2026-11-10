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

function formHarness({ autoPaste = false, clipboard = Promise.resolve(""), save = async () => {}, initialUrls } = {}) {
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
    "../../theme/tokens": { spacing: {} },
    "../ui/toast-store": { toast: { success: message => notices.push(message) } },
    "./use-opening-focus": { useOpeningFocus: () => ({}) },
    "./BookmarkLinkField": { BookmarkLinkLayout: "LinkLayout", BookmarkLinkField: "LinkField", useBookmarkLinkActions: value => value },
    "./FolderPickerMenu": {}, "./LockPrompt": {}, "./CreateFolderPanel": {},
    "../tags/TagSelectList": {}, "../tags/CreateTagPanel": {},
  }, "\nexport { AddBookmarkContent as Content };");
  const props = { visible: true, folderId: null, initialUrls, onDismiss() {} };
  const find = (tree, type) => {
    if (!tree) return null;
    if (Array.isArray(tree)) return tree.map(child => find(child, type)).find(Boolean);
    return tree.type === type ? tree : find(tree.props?.children, type);
  };
  return { runner, props, writes, notices, render() {
    const tree = runner.render(Content, props);
    const fields = find(tree, "LinkLayout").props.fields;
    return { fields, actions: fields[0].props.actions, confirm: find(tree, "PanelActions").props.onConfirm };
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
  assert.equal(auto.render().fields.length, 2, "auto-paste creates one field per link");
  const late = deferred(), typed = formHarness({ autoPaste: true, clipboard: late.promise });
  typed.render().actions.onChange(0, "my-edit.example");
  late.resolve("https://one.example https://two.example"); await tick();
  assert.equal(typed.render().fields[0].props.draft.url, "my-edit.example", "late clipboard reads preserve typed edits");
  const shared = formHarness({ autoPaste: true, initialUrls: ["https://shared.example"], clipboard: Promise.resolve("https://one.example https://two.example") });
  shared.render(); await tick();
  assert.equal(shared.render().fields[0].props.draft.url, "https://shared.example", "explicit intake beats clipboard");
  const keyboard = formHarness();
  keyboard.render().actions.onChange(0, "https://one.example https://two.example https://one.example");
  assert.equal(keyboard.render().fields.length, 2, "native keyboard paste splits and deduplicates");
  const nested = "https://one.example/?next=https://two.example/a?";
  keyboard.render().actions.onChange(0, nested);
  assert.equal(keyboard.render().fields[0].props.draft.url, nested, "typing a nested URL must not rewrite the field");
  const paste = formHarness({ initialUrls: ["https://old.example", "https://keep.example"], clipboard: Promise.resolve("https://one.example https://two.example") });
  paste.render().actions.onPaste(0); await tick();
  assert.deepEqual(plain(paste.render().fields.map(field => field.props.draft.url)), ["https://one.example/", "https://two.example/", "https://keep.example"]);
  let offline = true;
  const saving = formHarness({ initialUrls: ["https://one.example", "https://two.example", "https://three.example"],
    save: async value => { if (offline && value.url.includes("two")) throw Error("Offline"); } });
  saving.render().confirm(); await tick();
  assert.deepEqual(plain(saving.render().fields.map(field => field.props.draft.url)), ["https://two.example", "https://three.example"]);
  offline = false; saving.render().confirm(); await tick();
  assert.equal(saving.writes.filter(value => value.url.includes("one")).length, 1, "retry does not resave successful links");
  console.log("PASS: multi-link extraction, share intake, native fallback review, cancellation, auto-paste, keyboard paste, draft preservation and partial-save retries");
})().catch(error => { console.error(error); process.exitCode = 1; });
