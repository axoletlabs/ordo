/** Execute production mutation/delete code with real TanStack caches. Only
 * native storage, auth and HTTP boundaries are substituted; no copied reducers. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import * as reactQuery from "@tanstack/react-query";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../src");
const stamp = "2026-10-15T12:00:00Z";
const book = (patch = {}) => ({ id: "deepswe", folderId: "sleep", url: "https://example.test", title: "DeepSWE",
  domain: "example.test", tags: [], suggestedTags: [], isRead: false, remindAt: null, createdAt: stamp, updatedAt: stamp, ...patch });
const folder = (patch = {}) => ({ id: "sleep", name: "sleep", protected: true, bookmarkCount: 1, unreadCount: 1, createdAt: stamp, ...patch });
const paged = items => ({ pages: [{ items, hasMore: false, nextCursor: null }], pageParams: [null] });
const drain = () => new Promise(resolve => setImmediate(resolve));

function harness(disk = new Map(), platform = "web") {
  const qc = new reactQuery.QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } } });
  const modules = new Map(), requests = [], timers = [];
  const auth = { status: "authenticated", user: { id: "alice" } };
  const settings = { serverUrl: "https://ordo.example.test" };
  const state = { fail: null, bookmark: book(), calls: 0, storageFails: false };
  const window = { localStorage: {
    getItem: key => disk.get(key) ?? null,
    setItem: (key, value) => { if (state.storageFails) throw new Error("Storage full"); disk.set(key, value); },
  } };
  const api = {
    update: async (id, patch) => { if (state.fail) throw state.fail; return state.bookmark = { ...state.bookmark, ...patch, updatedAt: "2026-10-15T12:00:01Z" }; },
    batch: async () => { if (state.fail) throw state.fail; return { updated: 2 }; },
    remove: async id => { requests.push(["bookmark", id, auth.user.id, settings.serverUrl]); if (state.fail) throw state.fail; },
    detail: async () => state.bookmark,
  };
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = id => {
      if (id === "@tanstack/react-query") return { ...reactQuery, useQueryClient: () => qc,
        useMutation: options => ({ options, mutateAsync: variables => qc.getMutationCache().build(qc, options).execute(variables) }),
        useInfiniteQuery: options => options, useQuery: options => options };
      if (id === "react-native") return { Platform: { OS: platform } };
      if (id === "react-native-mmkv") return { createMMKV: () => ({
        getString: key => disk.get(key),
        set: (key, value) => { if (state.storageFails) throw new Error("Storage full"); disk.set(key, value); },
      }) };
      if (id.endsWith("/query-client")) return { queryClient: qc };
      if (id.endsWith("/api/bookmarks")) return { bookmarksApi: api };
      if (id.endsWith("/api/folders")) return { foldersApi: { remove: async folderId => { requests.push(["folder", folderId, auth.user.id, settings.serverUrl]); if (state.fail) throw state.fail; } } };
      if (id.endsWith("/api/tags")) return { tagsApi: { remove: async tagId => { requests.push(["tag", tagId]); if (state.fail) throw state.fail; } } };
      if (id.endsWith("/store/auth")) return { useAuthStore: { getState: () => auth } };
      if (id.endsWith("/store/settings")) return { useSettingsStore: { getState: () => settings } };
      if (id.endsWith("/folder-tokens")) return { useFolderTokenStore: { getState: () => ({ get: () => "token", clear() {} }) } };
      if (id.endsWith("/store/list-sort")) return { useListSortStore: () => "newest" };
      if (id.endsWith("/error-message")) return { errorMessage: (error, fallback) => error.message ?? fallback };
      if (id.endsWith("/haptics")) return { haptics: { success() {} } };
      if (id.endsWith("/reminder-notifications")) return { cancelBookmarkReminder() {}, syncBookmarkReminder() {} };
      if (id.startsWith(".")) {
        const name = resolve(dirname(filename), id);
        for (const ext of [".ts", ".tsx"]) if (existsSync(name + ext)) return load(name + ext);
      }
      return require(id);
    };
    new Function("require", "module", "exports", "window", "setTimeout", "clearTimeout", code)(localRequire, module, module.exports, window,
      (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, timer => { timer.cancelled = true; });
    return module.exports;
  }
  const get = name => load(resolve(root, name));
  const { qk } = get("lib/api/query-keys.ts");
  const hooks = get("hooks/use-bookmarks.ts");
  const deletion = get("lib/undoable-delete.ts");
  const journal = get("lib/delete-journal.ts");
  const toastStore = get("components/ui/toast-store.ts").useToastStore;
  const rows = id => qc.getQueryData(qk.bookmarks(id, "newest"))?.pages.flatMap(page => page.items) ?? [];
  const seed = (bookmark = book()) => {
    state.bookmark = bookmark;
    qc.setQueryData(qk.folders, [folder({ bookmarkCount: bookmark.folderId ? 1 : 0 })]);
    qc.setQueryData(qk.bookmarks(null, "newest"), paged(bookmark.folderId ? [] : [bookmark]));
    qc.setQueryData(qk.bookmarks("sleep", "newest"), paged(bookmark.folderId ? [bookmark] : []));
    qc.setQueryData(qk.bookmark(bookmark.id), { ...bookmark, contentHtml: "<p>Reader</p>", highlights: [{ id: "highlight" }] });
  };
  return { qc, qk, hooks, ...deletion, journal, toastStore, rows, seed, state, requests, timers, auth, settings, disk, api, get };
}

test("recorded sequence: move out, delete empty folder, Undo never moves the bookmark back", async () => {
  const h = harness(); h.seed();
  await h.hooks.useMoveBookmark("sleep").mutateAsync({ id: "deepswe", toFolderId: null });
  const detail = h.qc.getQueryData(h.qk.bookmark("deepswe"));
  assert.equal(detail.folderId, null); assert.equal(detail.contentHtml, "<p>Reader</p>");
  assert.equal(detail.highlights.length, 1); assert.equal(detail.updatedAt, "2026-10-15T12:00:01Z");
  assert.equal(h.qc.getQueryState(h.qk.folders).isInvalidated, true);
  const undo = h.deleteUndoable({ folders: [folder({ bookmarkCount: 0 })] });
  assert.equal(h.rows(null).length, 1, "Deleting an empty folder must not hide a moved-out bookmark");
  undo.undo();
  assert.equal(h.rows(null).length, 1); assert.equal(h.rows("sleep").length, 0);
  assert.equal(h.qc.getQueryData(h.qk.folders)[0].bookmarkCount, 0);
  assert.equal(h.state.bookmark.folderId, null);
});

test("delete resolves newest membership before considering stale reader/index copies", () => {
  const h = harness(); h.seed(book({ folderId: null, updatedAt: "2026-10-15T12:00:02Z" }));
  h.qc.setQueryData(h.qk.bookmark("deepswe"), book());
  h.qc.setQueryData(h.qk.libraryIndex(0), paged([book()]));
  h.deleteUndoable({ folders: [folder({ bookmarkCount: 0 })] }).undo();
  assert.equal(h.rows(null).length, 1); assert.equal(h.rows("sleep").length, 0);
});

test("move updates inactive indexes, details, reminders and every destination sort", async () => {
  const h = harness(); h.seed();
  h.qc.setQueryData(h.qk.libraryIndex(0), paged([book()]));
  h.qc.setQueryData(h.qk.bookmarks(null, "title"), paged([book({ id: "aaa", folderId: null, title: "A" })]));
  h.qc.setQueryData(h.qk.reminders, [{ id: "deepswe", folderId: "sleep", remindAt: 2_000_000_000 }]);
  h.state.bookmark = book({ remindAt: 2_000_000_000 });
  await h.hooks.useMoveBookmark("sleep").mutateAsync({ id: "deepswe", toFolderId: null });
  assert.equal(h.qc.getQueryData(h.qk.libraryIndex(0)).pages[0].items[0].folderId, null);
  assert.deepEqual(h.qc.getQueryData(h.qk.bookmarks(null, "title")).pages[0].items.map(b => b.title), ["A", "DeepSWE"]);
  assert.equal(h.qc.getQueryData(h.qk.reminders)[0].folderId, null);
});

test("moving a search result removes it from a folder-filtered result cache", async () => {
  const h = harness(); h.seed();
  const key = h.qk.search("deep", [], "all", ["sleep"]);
  h.qc.setQueryData(key, paged([book()]));
  await h.hooks.useMoveBookmark("sleep").mutateAsync({ id: "deepswe", toFolderId: null });
  assert.equal(h.qc.getQueryData(key).pages[0].items.length, 0);
});

test("a failed move restores lists, rich detail, index, counts and reminders", async () => {
  const h = harness(); h.seed();
  h.qc.setQueryData(h.qk.libraryIndex(0), paged([book()]));
  h.state.fail = new Error("Move failed");
  await assert.rejects(h.hooks.useMoveBookmark("sleep").mutateAsync({ id: "deepswe", toFolderId: null }));
  assert.equal(h.rows("sleep").length, 1); assert.equal(h.rows(null).length, 0);
  assert.equal(h.qc.getQueryData(h.qk.bookmark("deepswe")).folderId, "sleep");
  assert.equal(h.qc.getQueryData(h.qk.libraryIndex(0)).pages[0].items[0].folderId, "sleep");
  assert.equal(h.qc.getQueryData(h.qk.folders)[0].bookmarkCount, 1);
});

test("pre-move fetch cannot resurrect the row when its old response arrives", async () => {
  const h = harness(); h.seed(book({ folderId: null }));
  let finish;
  const fetch = h.qc.fetchQuery({ queryKey: h.qk.bookmarks(null, "newest"), queryFn: () => new Promise(resolve => { finish = resolve; }) }).catch(() => {});
  await h.hooks.useMoveBookmark(null).mutateAsync({ id: "deepswe", toFolderId: "sleep" });
  finish(paged([book({ folderId: null })])); await fetch;
  assert.equal(h.rows(null).length, 0); assert.equal(h.rows("sleep").length, 1);
});

test("cancelled reader prefetch cannot patch stale membership as a side effect", async () => {
  const h = harness(); h.seed();
  let finish;
  h.api.detail = () => new Promise(resolve => { finish = resolve; });
  await h.qc.invalidateQueries({ queryKey: h.qk.bookmark("deepswe") });
  const fetch = h.hooks.prefetchBookmarkDetail("deepswe", "sleep");
  await h.hooks.useMoveBookmark("sleep").mutateAsync({ id: "deepswe", toFolderId: null });
  finish(book()); await fetch; await drain();
  assert.equal(h.rows(null)[0].folderId, null);
  assert.equal(h.qc.getQueryData(h.qk.bookmark("deepswe")).folderId, null);
});

test("reader fetching works with React Native's minimal AbortSignal polyfill", async () => {
  const h = harness(); h.seed();
  const options = h.hooks.useBookmarkDetail("deepswe");
  const detail = await options.queryFn({ signal: { aborted: false } });
  assert.equal(detail.id, "deepswe");
  await assert.rejects(options.queryFn({ signal: { aborted: true } }), /cancelled/);
});

test("batch moves use the same immediate membership and counts updates", async () => {
  const h = harness(); h.seed();
  await h.hooks.useBatchBookmarks().mutateAsync({ action: "move", ids: ["deepswe"], folderId: null });
  assert.equal(h.rows("sleep").length, 0); assert.equal(h.rows(null).length, 1);
  assert.equal(h.qc.getQueryData(h.qk.bookmark("deepswe")).folderId, null);
  assert.equal(h.qc.getQueryData(h.qk.folders)[0].bookmarkCount, 0);
});

test("Undo restores actual catalogue/search membership, never unrelated filters", () => {
  const h = harness(); h.seed();
  const match = h.qk.search("DeepSWE"), unrelated = h.qk.search("unrelated");
  h.qc.setQueryData(match, paged([book()])); h.qc.setQueryData(unrelated, paged([]));
  h.qc.setQueryData(h.qk.libraryIndex(0), paged([book()]));
  h.deleteUndoable({ bookmarks: [book()] }).undo();
  assert.equal(h.qc.getQueryData(match).pages[0].items.length, 1);
  assert.equal(h.qc.getQueryData(unrelated).pages[0].items.length, 0);
  assert.equal(h.qc.getQueryData(h.qk.libraryIndex(0)).pages[0].items.length, 1);
});

test("queued/extended Undo has no independent commit timer; dismissal commits once", async () => {
  const h = harness(); h.seed();
  h.toastStore.getState().show("Earlier notification");
  h.deleteUndoable({ folders: [folder()] });
  assert.equal(h.timers.length, 0); assert.equal(h.requests.length, 0);
  const toast = h.toastStore.getState().toasts.at(-1);
  h.toastStore.getState().dismiss(toast.id); h.toastStore.getState().dismiss(toast.id);
  await drain(); assert.equal(h.requests.length, 1);
  assert.equal(h.journal.readDeleteIntents(h.journal.deleteJournalKey()).length, 0);
});

test("Undo cancels the durable intent before toast dismissal, without deleting", async () => {
  const h = harness(); h.seed(); h.deleteUndoable({ folders: [folder()] });
  const toast = h.toastStore.getState().toasts[0]; toast.action.onPress();
  h.toastStore.getState().dismiss(toast.id); await drain();
  assert.equal(h.requests.length, 0); assert.equal(h.qc.getQueryData(h.qk.folders).length, 1);
  assert.equal(h.journal.readDeleteIntents(h.journal.deleteJournalKey()).length, 0);
});

test("process death preserves deletion intent and a fresh process finishes it", async () => {
  const first = harness(); first.seed(); first.deleteUndoable({ folders: [folder()] });
  assert.equal(first.requests.length, 0);
  const second = harness(first.disk); second.seed(); second.resumePendingDeletes();
  assert.equal(second.qc.getQueryData(second.qk.folders).length, 0, "Hydrated tombstones apply before requests resolve");
  assert.equal(second.rows("sleep").length, 0);
  await drain();
  assert.equal(second.requests.length, 1);
  assert.equal(second.journal.readDeleteIntents(second.journal.deleteJournalKey()).length, 0);
  assert.ok(![...first.disk.values()].join().includes("DeepSWE"), "Journal must never persist content");
});

test("native MMKV journal also survives process death without storing content", async () => {
  const first = harness(new Map(), "android"); first.seed(); first.deleteUndoable({ folders: [folder()] });
  const second = harness(first.disk, "android"); second.seed(); second.resumePendingDeletes(); await drain();
  assert.equal(second.requests.length, 1);
  assert.equal(second.journal.readDeleteIntents(second.journal.deleteJournalKey()).length, 0);
  assert.ok(![...first.disk.values()].join().includes("DeepSWE"));
});

test("failed move rollback leaves another bookmark's successful concurrent move intact", async () => {
  const h = harness(); h.seed();
  const other = book({ id: "other", title: "Other" });
  h.qc.setQueryData(h.qk.bookmarks("sleep", "newest"), paged([book(), other]));
  h.qc.setQueryData(h.qk.folders, [folder({ bookmarkCount: 2, unreadCount: 2 })]);
  let failFirst;
  h.api.update = async (id, patch) => {
    if (id === "deepswe") return new Promise((_resolve, reject) => { failFirst = reject; });
    return { ...other, ...patch, updatedAt: "2026-10-15T12:00:01Z" };
  };
  const first = h.hooks.useMoveBookmark("sleep").mutateAsync({ id: "deepswe", toFolderId: null }).catch(() => {});
  await drain();
  await h.hooks.useMoveBookmark("sleep").mutateAsync({ id: "other", toFolderId: null });
  failFirst(new Error("Move failed")); await first;
  assert.deepEqual(h.rows(null).map(b => b.id), ["other"]);
  assert.deepEqual(h.rows("sleep").map(b => b.id), ["deepswe"]);
  assert.equal(h.qc.getQueryData(h.qk.folders)[0].bookmarkCount, 1);
});

test("foreground recovery cannot prematurely commit a still-visible queued Undo", async () => {
  const h = harness(); h.seed(); h.deleteUndoable({ folders: [folder()] });
  h.resumePendingDeletes(); await drain();
  assert.equal(h.requests.length, 0);
  h.toastStore.getState().toasts[0].action.onPress();
});

test("an empty recovery journal must not mark stale library caches fresh", () => {
  const h = harness(); h.seed();
  h.qc.setQueryData(h.qk.bookmarks(null, "newest"), paged([]), { updatedAt: 1 });
  h.resumePendingDeletes();
  assert.equal(h.qc.getQueryState(h.qk.bookmarks(null, "newest")).dataUpdatedAt, 1);
});

test("Undo storage failure returns false so the action remains available to retry", () => {
  const h = harness(); h.seed(); h.deleteUndoable({ folders: [folder()] });
  const toast = h.toastStore.getState().toasts[0];
  h.state.storageFails = true;
  assert.equal(toast.action.onPress(), false);
  assert.equal(h.qc.getQueryData(h.qk.folders).length, 0);
  h.state.storageFails = false;
  assert.equal(toast.action.onPress(), true);
  assert.equal(h.qc.getQueryData(h.qk.folders).length, 1);
});

test("expired folder access rolls back deletion and clears the durable intent", async () => {
  const h = harness(); h.seed(); const pending = h.deleteUndoable({ folders: [folder()] });
  h.state.fail = { status: 403, message: "Unlock this folder" };
  pending.commit(); await drain();
  assert.equal(h.qc.getQueryData(h.qk.folders).length, 1);
  assert.equal(h.rows("sleep").length, 1);
  assert.equal(h.journal.readDeleteIntents(h.journal.deleteJournalKey()).length, 0);
});

test("scope is rechecked between requests if account changes during a mixed delete", async () => {
  const h = harness(); h.seed(book({ folderId: null }));
  let complete;
  h.api.remove = async () => new Promise(resolve => { complete = resolve; });
  const pending = h.deleteUndoable({ folders: [folder({ bookmarkCount: 0 })], bookmarks: [book({ folderId: null })] });
  pending.commit(); await drain();
  h.auth.user.id = "bob"; complete(); await drain();
  assert.equal(h.requests.length, 0, "No folder delete can be sent as the replacement user");
});

test("journals and delayed commits cannot cross an account/server boundary", async () => {
  const h = harness(); h.seed(); const pending = h.deleteUndoable({ folders: [folder()] });
  h.auth.user.id = "bob"; pending.commit(); h.resumePendingDeletes(); await drain();
  assert.equal(h.requests.length, 0);
  h.auth.user.id = "alice"; h.settings.serverUrl = "https://another.example.test";
  pending.commit(); h.resumePendingDeletes(); await drain(); assert.equal(h.requests.length, 0);
  h.settings.serverUrl = "https://ordo.example.test"; pending.undo();
});

test("storage failure never hides rows or promises a deletion", () => {
  const h = harness(); h.seed(); h.state.storageFails = true;
  h.deleteUndoable({ folders: [folder()] });
  assert.equal(h.qc.getQueryData(h.qk.folders).length, 1); assert.equal(h.rows("sleep").length, 1);
  assert.equal(h.requests.length, 0); assert.equal(h.toastStore.getState().toasts[0].tone, "danger");
});

test("a lost DELETE response is idempotently completed after restart", async () => {
  const h = harness(); h.seed(); h.deleteUndoable({ folders: [folder()] });
  const second = harness(h.disk); second.state.fail = { status: 404 };
  second.resumePendingDeletes(); await drain();
  assert.equal(second.journal.readDeleteIntents(second.journal.deleteJournalKey()).length, 0);
});

test("transient delete failure stays durable and retries without resurrecting rows", async () => {
  const h = harness(); h.seed(); const pending = h.deleteUndoable({ folders: [folder()] });
  h.state.fail = { status: 503, message: "Unavailable" }; pending.commit(); await drain();
  assert.equal(h.qc.getQueryData(h.qk.folders).length, 0);
  assert.equal(h.journal.readDeleteIntents(h.journal.deleteJournalKey()).length, 1);
  h.state.fail = null; h.resumePendingDeletes(); await drain();
  assert.equal(h.journal.readDeleteIntents(h.journal.deleteJournalKey()).length, 0);
});
