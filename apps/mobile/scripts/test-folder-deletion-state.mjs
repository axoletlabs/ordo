#!/usr/bin/env node
/** Folder-deletion state regressions (journal, undo, keeps, replay, access).
 * Runs the REAL apps/mobile state modules (undoable-delete + cache-helpers)
 * against an in-memory QueryClient with stubbed API/journal/storage layers:
 *   node --test apps/mobile/scripts/test-folder-deletion-state.mjs
 * Real-HTTP equivalents live in scripts/test-folder-preservation-api.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";
import { DEFAULT_BOOKMARK_LIST_SORT } from "@ordo/shared";

const require = createRequire(import.meta.url);

/** Transpile app TypeScript without a bundler; native/store imports are stubs. */
function loadAppModule(relativePath, stubs, cache, fromUrl) {
  const baseUrl = fromUrl ?? new URL("../src/lib/undoable-delete.ts", import.meta.url);
  const filename = new URL(relativePath, baseUrl);
  const cacheKey = filename.href;
  const cached = cache.get(cacheKey);
  if (cached) return cached.exports ?? cached;
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: fileURLToPath(filename),
  });
  const module = { exports: {} };
  cache.set(cacheKey, module);
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, {
    filename: fileURLToPath(filename),
  })(
    (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith(".")) {
        return loadAppModule(`${name}.ts`, stubs, cache, filename);
      }
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}

/** Minimal ApiClientError mirroring lib/api/client.ts (status + code + message). */
class ApiClientError extends Error {
  constructor(status, body, fallbackMessage) {
    super(body?.message || fallbackMessage || "Something went wrong");
    this.name = "ApiClientError";
    this.code = body?.code ?? "unknown_error";
    this.status = status;
  }
}

function folder(id, overrides = {}) {
  return {
    id, name: `Folder ${id}`, icon: "folder-outline", pinned: false,
    protected: false, lockType: null, pinLength: null,
    bookmarkCount: 3, unreadCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function bookmark(id, folderId, overrides = {}) {
  return {
    id, folderId, url: `https://example.test/${id}`, title: `Item ${id}`,
    domain: "example.test", description: null, isRead: true,
    remindAt: null, tags: [], suggestedTags: [],
    contentKind: "web", contentKindOverride: null, fetchStatus: "unsupported",
    readingTimeMinutes: null, readProgress: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paged(items) {
  return { pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] };
}

const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

/** Fresh world: real undoable-delete + cache-helpers, stubbed edges. */
function setupWorld() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const apiLog = [];
  const toasts = [];
  const journalStore = new Map();
  const folderTokens = { tokens: {}, cleared: [] };
  let deleteWithKeepsBehavior = async () => ({ success: true, keptIds: [], keptBookmarks: 0, deletedBookmarks: 0 });

  const journalKey = "journal-test";
  const stubs = {
    "@ordo/shared": require("@ordo/shared"),
    "./api/client": { ApiClientError },
    "./error-message": { errorMessage: (cause, fallback = "Something went wrong.") => cause?.message || fallback },
    "./session-scope": {
      captureSessionScope: () => ({ server: "http://test", generation: 1 }),
      isSessionScopeCurrent: () => true,
      assertSessionScope: () => {},
      SessionChangedError: class SessionChangedError extends Error {},
    },
    "./query-client": { queryClient },
    "./haptics": { haptics: { success() {}, error() {}, medium() {} } },
    "../components/ui/toast-store": {
      toast: {
        success: (message, opts) => { toasts.push({ tone: "success", message, opts }); return `t${toasts.length}`; },
        error: (message) => { toasts.push({ tone: "error", message }); return `t${toasts.length}`; },
        dismiss: () => {},
      },
    },
    "../store/folder-tokens": {
      useFolderTokenStore: {
        getState: () => ({
          get: (id) => folderTokens.tokens[id] ?? null,
          clear: (id) => { delete folderTokens.tokens[id]; folderTokens.cleared.push(id); },
        }),
      },
    },
    "./delete-journal": {
      deleteJournalKey: () => journalKey,
      readDeleteIntents: (key) => journalStore.get(key) ?? [],
      recordDeleteIntent: (input) => {
        const intent = { ...input, id: `i${journalStore.size + 1}-${Date.now()}` };
        journalStore.set(journalKey, [...(journalStore.get(journalKey) ?? []), intent]);
        return { key: journalKey, intent };
      },
      forgetDeleteIntent: (key, id) => {
        journalStore.set(key, (journalStore.get(key) ?? []).filter((intent) => intent.id !== id));
      },
    },
    "./api/folders": {
      foldersApi: {
        deleteWithKeeps: async (id, keepIds) => {
          apiLog.push({ api: "folders.deleteWithKeeps", id, keepIds: [...keepIds] });
          return deleteWithKeepsBehavior(id, [...keepIds]);
        },
        remove: async (id) => {
          apiLog.push({ api: "folders.remove", id });
          return { success: true };
        },
        batch: async (body) => {
          apiLog.push({ api: "folders.batch", body: { ...body } });
          return { updated: body.ids.length };
        },
      },
    },
    "./api/bookmarks": {
      bookmarksApi: {
        batch: async (body) => {
          apiLog.push({ api: "bookmarks.batch", body: { ...body } });
          if (body.action === "move") throw new Error("legacy keep move must never run");
          return { updated: body.ids.length };
        },
        remove: async (id) => { apiLog.push({ api: "bookmarks.remove", id }); return { success: true }; },
        update: async (id, body2) => {
          apiLog.push({ api: "bookmarks.update", id, body: { ...body2 } });
          if (body2?.folderId === null) throw new Error("legacy keep move must never run");
          return bookmark(id, body2?.folderId ?? null);
        },
        list: async () => { throw new Error("legacy membership read must never run"); },
      },
    },
    "./api/tags": { tagsApi: { remove: async (id) => { apiLog.push({ api: "tags.remove", id }); } } },
  };

  const undoable = loadAppModule("./undoable-delete.ts", stubs, new Map());
  const { qk } = loadAppModule("./api/query-keys.ts", stubs, new Map());

  return {
    undoable, qk, queryClient, apiLog, toasts,
    journal: () => journalStore.get(journalKey) ?? [],
    seedJournal: (intents) => journalStore.set(journalKey, intents),
    tokens: folderTokens,
    onDeleteWithKeeps(fn) { deleteWithKeepsBehavior = fn; },
    seed(folderRows, { unfiled = [], folderLists = {}, details = [], catalogue = [] } = {}) {
      queryClient.setQueryData(qk.folders, folderRows);
      queryClient.setQueryData(qk.bookmarks(null, DEFAULT_BOOKMARK_LIST_SORT), paged(unfiled));
      for (const [folderId, items] of Object.entries(folderLists)) {
        queryClient.setQueryData(qk.bookmarks(folderId, DEFAULT_BOOKMARK_LIST_SORT), paged(items));
      }
      for (const row of details) queryClient.setQueryData(qk.bookmark(row.id), row);
      queryClient.setQueryData(qk.libraryIndex(0), paged(catalogue));
    },
    /** True when the replay requested a full catalogue reconciliation
     * (invalidateDeletedLists(true)) — the required outcome whenever a keep
     * has no cached row to paint locally. Observable without refetches. */
    catalogueInvalidated() {
      return queryClient.getQueryState(qk.libraryIndex(0))?.isInvalidated === true;
    },
    listItems(folderId) {
      const data = queryClient.getQueryData(qk.bookmarks(folderId, DEFAULT_BOOKMARK_LIST_SORT));
      return data ? data.pages.flatMap((page) => page.items) : undefined;
    },
    unfiledItems() {
      return queryClient.getQueryData(qk.bookmarks(null, DEFAULT_BOOKMARK_LIST_SORT))
        .pages.flatMap((page) => page.items);
    },
    folderRows() { return queryClient.getQueryData(qk.folders) ?? []; },
  };
}

const test = async (name, run) => {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (cause) {
    console.error(`FAIL ${name}`);
    throw cause;
  }
};

// 1. Atomic success: keptIds paint the unfiled root; folder never cascaded twice.
await test("atomic keep success paints unfiled and skips cascade delete", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const keep = bookmark("b-keep", "f1");
  const cascade = bookmark("b-cascade", "f1");
  world.seed([f], {
    unfiled: [bookmark("b-root", null)],
    folderLists: { f1: [keep, cascade] },
    details: [keep, cascade],
    catalogue: [keep, cascade],
  });
  world.onDeleteWithKeeps(async (id, keepIds) => {
    assert.equal(id, "f1");
    assert.deepEqual(keepIds, ["b-keep"]);
    return { success: true, keptIds: ["b-keep"], keptBookmarks: 1, deletedBookmarks: 1 };
  });

  const handle = world.undoable.deleteUndoable({ folders: [f], keepIds: ["b-keep"] });
  await flush();
  handle.commit();
  await flush();

  assert.deepEqual(world.journal(), []);
  assert.ok(world.apiLog.some((entry) => entry.api === "folders.deleteWithKeeps" && entry.keepIds.includes("b-keep")));
  assert.ok(!world.apiLog.some((entry) => entry.api === "folders.remove" && entry.id === "f1"), "atomic folder must not be cascade-deleted again");
  assert.ok(!world.apiLog.some((entry) => entry.api === "folders.batch"), "no legacy folder batch delete");
  const unfiled = world.unfiledItems();
  assert.ok(unfiled.some((row) => row.id === "b-keep" && row.folderId === null), "kept row must be unfiled with folderId null");
  assert.ok(!unfiled.some((row) => row.id === "b-cascade"));
  assert.deepEqual(world.folderRows(), [], "folders cache drops the deleted folder");
  assert.deepEqual(world.tokens.cleared, ["f1"], "folder token cleared");
  assert.equal(world.catalogueInvalidated(), false, "cached-row keep is painted locally; no full catalogue replay");
});

// 2. Cross-device race: a keep moved to another folder is never ripped to null.
await test("keep moved to another folder stays out of the unfiled root", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const g = folder("g1");
  const moved = bookmark("b-moved", "g1");
  const kept = bookmark("b-kept", "f1");
  world.seed([f, g], {
    unfiled: [],
    folderLists: { f1: [kept], g1: [moved] },
    details: [moved, kept],
  });
  world.onDeleteWithKeeps(async () => ({
    success: true, keptIds: ["b-kept"], keptBookmarks: 1, deletedBookmarks: 0,
  }));

  const handle = world.undoable.deleteUndoable({ folders: [f], keepIds: ["b-moved", "b-kept"] });
  await flush();
  handle.commit();
  await flush();

  const unfiled = world.unfiledItems();
  assert.ok(!unfiled.some((row) => row.id === "b-moved"), "moved-elsewhere keep must not be painted unfiled");
  assert.ok(unfiled.some((row) => row.id === "b-kept"));
  assert.equal(world.queryClient.getQueryData(world.qk.bookmark("b-moved")), undefined, "stale detail for the moved keep is purged, refetch reconciles");
  assert.deepEqual(world.journal(), []);
  assert.ok(world.apiLog.every((entry) => !(entry.api === "bookmarks.batch" && entry.body.action === "move")), "no move calls at all");
});

// 3. Old server (route missing): fail safely, never emulate with legacy moves.
await test("route-missing endpoint fails safely without legacy moves", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const keep = bookmark("b-keep", "f1");
  world.seed([f], { unfiled: [], folderLists: { f1: [keep] } });
  world.onDeleteWithKeeps(async () => {
    throw new ApiClientError(404, null, "Cannot POST /api/folders/f1/delete");
  });

  const handle = world.undoable.deleteUndoable({ folders: [f], keepIds: ["b-keep"] });
  await flush();
  handle.commit();
  await flush();

  assert.deepEqual(world.journal(), [], "terminal 4xx forgets the intent");
  assert.ok(world.toasts.some((entry) => entry.tone === "error" && entry.message === "Update your server before keeping bookmarks when deleting a folder."));
  assert.ok(!world.apiLog.some((entry) => entry.api === "folders.remove"), "no legacy folder delete after unsupported endpoint");
  assert.ok(!world.apiLog.some((entry) => entry.api === "bookmarks.batch" || entry.api === "bookmarks.update"), "no bookmark mutations at all");
});

// 4. Folder already gone (lost response retry): keeps reconcile, cascade skipped.
await test("folder-gone 404 treats keeps as elsewhere and skips cascade", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const keep = bookmark("b-keep", "f1");
  world.seed([f], { unfiled: [], folderLists: { f1: [keep] }, details: [keep] });
  world.onDeleteWithKeeps(async () => {
    throw new ApiClientError(404, { code: "folder_not_found", message: "This folder no longer exists." });
  });

  const handle = world.undoable.deleteUndoable({ folders: [f], keepIds: ["b-keep"] });
  await flush();
  handle.commit();
  await flush();

  assert.deepEqual(world.journal(), []);
  assert.ok(!world.apiLog.some((entry) => entry.api === "folders.remove"), "already-deleted folder is not re-deleted");
  assert.ok(!world.unfiledItems().some((row) => row.id === "b-keep"), "unknown disposition is not painted unfiled");
  assert.equal(world.queryClient.getQueryData(world.qk.bookmark("b-keep")), undefined, "row purged for refetch reconciliation");
});

// 5. Overlapping intents: a pending bookmark delete ticked as a keep survives Undo.
await test("keep ticked while its own delete is pending survives that delete's Undo", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const contested = bookmark("b-contested", "f1");
  const other = bookmark("b-other", "f1");
  world.seed([f], {
    unfiled: [],
    folderLists: { f1: [contested, other] },
    details: [contested, other],
    catalogue: [contested, other],
  });
  let preserved;
  world.onDeleteWithKeeps(async (_id, keepIds) => {
    preserved = [...keepIds];
    return { success: true, keptIds: keepIds, keptBookmarks: keepIds.length, deletedBookmarks: 0 };
  });

  const bookmarkDelete = world.undoable.deleteBookmarksUndoable([contested]);
  await flush();
  const folderDelete = world.undoable.deleteUndoable({ folders: [f], keepIds: [contested.id, other.id] });
  await flush();

  const folderIntent = world.journal().find((intent) => intent.folders.includes("f1"));
  assert.ok(folderIntent, "folder intent journaled");
  assert.deepEqual(
    folderIntent.keeps?.map((keep) => keep.id).sort(),
    ["b-contested", "b-other"],
    "every explicit tick is journaled even while its own delete is pending",
  );

  bookmarkDelete.undo(); // user reclaims the contested bookmark…
  await flush();
  folderDelete.commit(); // …then the folder delete must still keep it
  await flush();

  // The undo re-entered the row inside the folder-delete window, so the
  // stripper suppresses its cached copies: the replay cannot paint it locally
  // and MUST request a full catalogue reconciliation instead.
  assert.deepEqual(preserved, ["b-contested", "b-other"], "server was asked to preserve both ticks, including the just-undone bookmark");
  assert.deepEqual(world.journal(), [], "both intents settled");
  const unfiled = world.unfiledItems();
  assert.ok(unfiled.some((row) => row.id === "b-other" && row.folderId === null), "row with a cached copy is painted unfiled");
  const f1Rows = world.listItems("f1") ?? [];
  assert.ok(!f1Rows.some((row) => row.id === "b-contested"), "rowless keep is not resurrected into the deleted folder");
  assert.ok(!unfiled.some((row) => row.id === "b-contested" && row.folderId === "f1"), "rowless keep is never painted with the deleted folder");
  assert.equal(world.catalogueInvalidated(), true, "missing cache row forces a full catalogue reconcile");
});

// 6. Locked-folder preflight: refuse before journaling or hiding anything.
await test("locked folder without token is refused before journaling", async () => {
  const world = setupWorld();
  const locked = folder("f-locked", { protected: true, lockType: "password" });
  world.seed([locked], { unfiled: [], folderLists: {} });

  world.undoable.deleteUndoable({ folders: [locked], keepIds: [] });
  await flush();

  assert.deepEqual(world.journal(), [], "nothing journaled");
  assert.deepEqual(world.folderRows().map((row) => row.id), ["f-locked"], "folder not hidden");
  assert.ok(world.toasts.some((entry) => entry.tone === "error" && entry.message === "This folder is locked."));
});

// 7. Replay-start recheck: token expiry after journaling fails before any call.
await test("expired token at replay start fails before server mutations", async () => {
  const world = setupWorld();
  const locked = folder("f-locked", { protected: true, lockType: "password" });
  world.seed([locked], { unfiled: [], folderLists: {} });
  world.tokens.tokens["f-locked"] = "live-token";

  const handle = world.undoable.deleteUndoable({ folders: [locked], keepIds: [] });
  await flush();
  delete world.tokens.tokens["f-locked"]; // token expires inside the undo window
  handle.commit();
  await flush();

  assert.deepEqual(world.apiLog, [], "no server call was made");
  assert.deepEqual(world.journal(), [], "terminal 4xx forgets the intent");
  assert.ok(world.toasts.some((entry) => entry.tone === "error" && entry.message === "This folder is locked."));
});

// 8. Terminal partial failure: committed rows are not resurrected by rollback.
await test("mixed delete partial failure does not resurrect committed rows", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const standalone = bookmark("b-standalone", null);
  const keep = bookmark("b-keep", "f1");
  world.seed([f], { unfiled: [standalone], folderLists: { f1: [keep] }, details: [standalone, keep] });
  world.onDeleteWithKeeps(async () => {
    throw new ApiClientError(403, { code: "folder_protected", message: "This folder is locked." });
  });

  const handle = world.undoable.deleteUndoable({ folders: [f], bookmarks: [standalone], keepIds: [keep.id] });
  await flush();
  handle.commit();
  await flush();

  // The standalone delete chunk commits before the preserve endpoint refuses.
  const standaloneDeleteIndex = world.apiLog.findIndex((entry) =>
    (entry.api === "bookmarks.batch" && entry.body.action === "delete" && entry.body.ids.includes("b-standalone")) ||
    (entry.api === "bookmarks.remove" && entry.id === "b-standalone"));
  const preserveIndex = world.apiLog.findIndex((entry) => entry.api === "folders.deleteWithKeeps");
  assert.ok(standaloneDeleteIndex >= 0, "standalone delete ran first");
  assert.ok(preserveIndex > standaloneDeleteIndex, "preserve endpoint is the failure point");

  assert.deepEqual(world.journal(), [], "terminal 4xx forgets the intent");
  assert.ok(!world.unfiledItems().some((row) => row.id === "b-standalone"), "server-deleted row is not restored as unfiled");
  assert.ok(!world.folderRows().some((row) => row.id === "f1"), "failed folder is not restored from the hide-time snapshot");
  assert.equal(world.catalogueInvalidated(), true, "terminal failure reconciles by full refetch");
  assert.ok(world.toasts.some((entry) => entry.tone === "error" && entry.message === "This folder is locked."));
});

// 9. Undo restores the folder, its rows, and the kept ticks in place.
await test("undo restores folder rows and kept ticks to the folder list", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const keep = bookmark("b-keep", "f1");
  const cascade = bookmark("b-cascade", "f1");
  world.seed([f], { unfiled: [], folderLists: { f1: [keep, cascade] }, details: [keep, cascade] });
  world.onDeleteWithKeeps(async () => ({ success: true, keptIds: [], keptBookmarks: 0, deletedBookmarks: 0 }));

  const handle = world.undoable.deleteUndoable({ folders: [f], keepIds: [keep.id] });
  await flush();
  handle.undo();
  await flush();

  assert.deepEqual(world.folderRows().map((row) => row.id), ["f1"], "folder restored");
  const rows = world.listItems("f1");
  assert.deepEqual(rows.map((row) => row.id).sort(), ["b-cascade", "b-keep"], "rows restored in place");
  assert.deepEqual(world.journal(), [], "undo forgets the intent");
});

// 10. Process-death resume: durable ID-only keep intents replay atomically.
await test("resumePendingDeletes finishes ID-only journaled keeps atomically", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const keep = bookmark("b-keep", "f1");
  world.seed([f], { unfiled: [], folderLists: { f1: [keep] }, details: [keep], catalogue: [keep] });
  let preserved;
  world.onDeleteWithKeeps(async (_id, keepIds) => {
    preserved = [...keepIds];
    return { success: true, keptIds: keepIds, keptBookmarks: keepIds.length, deletedBookmarks: 0 };
  });

  world.undoable.resumePendingDeletes();
  await flush();
  assert.equal(world.apiLog.length, 0, "empty journal replays nothing");

  // A journal written by a previous process: IDs only, no row snapshots.
  world.seedJournal([{
    id: "legacy-1",
    bookmarks: [],
    folders: ["f1"],
    tags: [],
    contained: [],
    keeps: [{ id: "b-keep", folderId: "f1" }],
  }]);
  world.undoable.resumePendingDeletes();
  await flush();

  assert.deepEqual(preserved, ["b-keep"], "atomic endpoint received the ID-only keep");
  assert.deepEqual(world.journal(), [], "completed intent is forgotten");
  assert.ok(!world.apiLog.some((entry) => entry.api === "folders.remove"), "atomically deleted folder is not cascade-deleted");
  // resumePendingDeletes tombstones the persisted cache before the replay
  // collects rows: the kept row has no cached copy left, so the replay must
  // not paint anything locally — it requests a full catalogue reconcile.
  assert.ok(!(world.listItems("f1") ?? []).some((row) => row.id === "b-keep"), "tombstoned folder row stays stripped");
  assert.ok(!world.unfiledItems().some((row) => row.id === "b-keep" && row.folderId === "f1"), "no stale-folder paint");
  assert.equal(world.catalogueInvalidated(), true, "rowless keep forces a full catalogue reconcile");
  assert.deepEqual(world.tokens.cleared, ["f1"], "token cleared after replay");
});

// 11. Picker-only rows (plain BookmarkDto[] cache) still journal and paint.
await test("keep rows only present in the picker cache journal and paint after commit", async () => {
  const world = setupWorld();
  const f = folder("f1");
  const cachedRow = bookmark("b-listed", "f1");
  const pickerOnly = bookmark("b-picker-only", "f1");
  world.seed([f], { unfiled: [], folderLists: { f1: [cachedRow] }, details: [] });
  // The keep picker's query: a plain array, keyed with the access revision.
  world.queryClient.setQueryData(["bookmarks", "folder-options", "f1", 0], [cachedRow, pickerOnly]);
  let preserved;
  world.onDeleteWithKeeps(async (_id, keepIds) => {
    preserved = [...keepIds];
    return { success: true, keptIds: keepIds, keptBookmarks: keepIds.length, deletedBookmarks: 0 };
  });

  const handle = world.undoable.deleteUndoable({ folders: [f], keepIds: [pickerOnly.id] });
  await flush();
  const intent = world.journal().find((row) => row.folders.includes("f1"));
  assert.ok(intent, "folder intent journaled");
  assert.deepEqual(intent.keeps, [{ id: "b-picker-only", folderId: "f1" }], "picker-only tick is journaled");

  handle.commit();
  await flush();
  assert.deepEqual(preserved, ["b-picker-only"]);
  const unfiled = world.unfiledItems();
  assert.ok(unfiled.some((row) => row.id === "b-picker-only" && row.folderId === null), "picker-only row painted unfiled from its array cache copy");
  assert.deepEqual(world.journal(), []);
});

// 12. Oversized keep selections are refused verbatim, never truncated.
await test("keep selection over the server limit is refused before hiding", async () => {
  const world = setupWorld();
  const f = folder("f1");
  world.seed([f], { unfiled: [], folderLists: {} });
  const keepIds = Array.from({ length: 20001 }, (_, index) => `keep-${index}`);

  world.undoable.deleteUndoable({ folders: [f], keepIds });
  await flush();

  assert.deepEqual(world.journal(), [], "nothing journaled");
  assert.deepEqual(world.folderRows().map((row) => row.id), ["f1"], "folder not hidden");
  assert.equal(world.apiLog.length, 0, "no server calls");
  assert.ok(world.toasts.some((entry) => entry.tone === "error" && entry.message === "Select at most 20000 bookmarks to keep."));
});

console.log("folder-deletion state regressions passed.");
