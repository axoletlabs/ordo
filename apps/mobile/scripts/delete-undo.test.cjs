/** Run with: node --test apps/mobile/scripts/delete-undo.test.cjs
 * Focused regression tests for the undoable-delete mutation/data layer:
 * confirm/undo cost structure, tombstones, offline replay, invalidation
 * scope, session isolation, tag propagation, and folder counts. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const mobileRequire = createRequire(resolve(__dirname, "../package.json"));
const ts = mobileRequire("typescript");
const reactQuery = mobileRequire("@tanstack/react-query");

const SRC = resolve(__dirname, "../src");

function transpile(file) {
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  return outputText;
}

function bookmark(i, folderId, extra = {}) {
  return {
    id: `b${i}`, url: `https://x.example/${i}`, title: `Bookmark ${i}`, domain: "x.example",
    createdAt: "2026-10-01", updatedAt: "2026-10-10", folderId, isRead: false, remindAt: null,
    tags: [], suggestedTags: [], contentKind: "web", fetchStatus: "ok", readingTimeMinutes: 3,
    readProgress: 0.1, description: "d", extractionReason: null, contentKindOverride: null,
    completedAt: null, ...extra,
  };
}

function folderDto(id, bookmarkCount, unreadCount, order = 0) {
  return { id, name: `Folder ${id}`, icon: "folder", pinned: false, bookmarkCount, unreadCount,
    protected: false, lockType: null, pinLength: null, createdAt: `2026-10-0${order + 1}` };
}

/** Loads undoable-delete with real cache-helpers/query-keys and only the
 * native/network/storage modules mocked. Everything mutation-related is real. */
function setup(shared = {}) {
  const qc = shared.qc ?? new reactQuery.QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const state = {
    journalKey: "test-journal",
    journal: [],
    scopeCurrent: true,
    calls: [],
    failWith: null, // e.g. { method: "bookmarks.batch", status: 500 }
    scopeChecks: 0,
  };
  const fail = (method, run) => async (...args) => {
    state.calls.push(`${method}:${JSON.stringify(args).length}`);
    if (state.failWith?.method === method) {
      throw Object.assign(new Error("mock failure"), { status: state.failWith.status });
    }
    return run(...args);
  };
  const api = {
    bookmarks: {
      batch: fail("bookmarks.batch", (body) => ({ updated: body.ids.length })),
      remove: fail("bookmarks.remove", () => ({ ok: true })),
      update: fail("bookmarks.update", () => ({ ok: true })),
    },
    folders: { batch: fail("folders.batch", () => ({ ok: true })), remove: fail("folders.remove", () => ({ ok: true })) },
    tags: { remove: fail("tags.remove", () => ({ ok: true })) },
  };

  const modules = new Map();
  const load = (filename) => {
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} };
    modules.set(filename, mod);
    const localRequire = (name) => {
      if (name === "@tanstack/react-query") return reactQuery;
      if (name === "../components/ui/toast-store") return {
        toast: {
          success: () => "t1", show: () => "t3", dismiss: () => {},
          error: (message) => { state.toastErrors ??= []; state.toastErrors.push(String(message)); return "t2"; },
        },
      };
      if (name === "./query-client") return { queryClient: qc };
      if (name === "./session-scope") return {
        captureSessionScope: () => ({ server: "s", generation: 1 }),
        isSessionScopeCurrent: () => { state.scopeChecks += 1; return state.scopeCurrent; },
        assertSessionScope: () => { if (!state.scopeCurrent) throw new Error("session changed"); },
      };
      if (name === "./haptics") return { haptics: { success: () => {}, medium: () => {}, error: () => {} } };
      if (name === "./error-message") return { errorMessage: (cause, fallback) => String(fallback ?? cause?.message ?? cause) };
      if (name === "./api/bookmarks") return { bookmarksApi: api.bookmarks };
      if (name === "./api/folders") return { foldersApi: api.folders };
      if (name === "./api/tags") return { tagsApi: api.tags };
      if (name === "../store/folder-tokens") return { useFolderTokenStore: { getState: () => ({ clear: () => {} }) } };
      if (name === "./delete-journal") return {
        deleteJournalKey: () => state.journalKey,
        readDeleteIntents: () => state.journal,
        recordDeleteIntent: (input) => {
          const intent = { ...input, id: `${state.journal.length}-${Math.random().toString(36).slice(2)}` };
          state.journal = [...state.journal, intent];
          return { key: state.journalKey, intent };
        },
        forgetDeleteIntent: (_key, id) => { state.journal = state.journal.filter((entry) => entry.id !== id); },
      };
      if (name === "./reminder-notifications") return {
        cancelBookmarkReminder: (id) => { (state.cancelledReminders ??= []).push(id); },
        syncBookmarkReminder: (b) => { (state.syncedReminders ??= []).push(b.id); },
      };
      if (name.startsWith(".")) return load(resolve(dirname(filename), `${name}.ts`));
      return require(name);
    };
    new Function("require", "module", "exports", transpile(filename))(localRequire, mod, mod.exports);
    return mod.exports;
  };
  const { qk } = load(resolve(SRC, "lib/api/query-keys.ts"));
  const undoable = load(resolve(SRC, "lib/undoable-delete.ts"));

  const seed = (opts = {}) => {
    const { folderRows = [bookmark(1, "f1"), bookmark(2, "f1", { remindAt: 123 })],
      catalogueRows = [...folderRows, bookmark(3, "f2")], unfiledRows = [bookmark(5, null, { remindAt: 456 })] } = opts;
    const paged = (items) => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] });
    qc.setQueryData(qk.bookmarks("f1", "newest"), paged(folderRows));
    qc.setQueryData(qk.bookmarks(null, "newest"), paged(unfiledRows));
    qc.setQueryData(qk.libraryIndex(0), paged(catalogueRows));
    qc.setQueryData(qk.search("example"), paged([...folderRows, bookmark(4, "f2")]));
    for (const row of folderRows) qc.setQueryData(qk.bookmark(row.id), { ...row, contentHtml: `<p>${row.id}</p>`, highlights: [] });
    qc.setQueryData(qk.reminders, folderRows.filter((row) => row.remindAt != null)
      .map((row) => ({ id: row.id, folderId: row.folderId, title: row.title, domain: row.domain, description: row.description, remindAt: row.remindAt })));
    return { folderRows, catalogueRows, unfiledRows };
  };
  const flushed = () => new Promise((resolveFlush) => setTimeout(resolveFlush, 20));
  const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));
  return { qc, qk, undoable, state, seed, flushed, tick, api };
}

const ids = (qc, key) => qc.getQueryData(key).pages.flatMap((page) => page.items).map((item) => item.id);

test("confirm hides rows in every list, detail, reminders, and folder counts in one pass", async () => {
  const { qc, qk, undoable, seed, state, tick } = setup();
  seed();
  qc.setQueryData(qk.folders, [folderDto("f1", 2, 1, 0), folderDto("f2", 1, 0, 1)]);
  const deleted = qc.getQueryData(qk.folders).find((f) => f.id === "f1");
  undoable.deleteUndoable({ folders: [deleted] });
  assert.deepEqual(ids(qc, qk.bookmarks("f1", "newest")), []);
  assert.deepEqual(ids(qc, qk.libraryIndex(0)), ["b3"]);
  assert.deepEqual(ids(qc, qk.search("example")), ["b4"]);
  assert.equal(qc.getQueryData(qk.bookmark("b1")), undefined);
  assert.equal(qc.getQueryData(qk.bookmark("b2")), undefined);
  assert.deepEqual(qc.getQueryData(qk.reminders), []);
  assert.deepEqual(qc.getQueryData(qk.folders).map((f) => f.id), ["f2"]);
  await tick();
  assert.deepEqual(state.cancelledReminders ?? [], ["b2"]);
});

test("undo restores every list, detail bodies, reminders, and folder counts", async () => {
  const { qc, qk, undoable, seed, state, tick } = setup();
  const { folderRows } = seed();
  qc.setQueryData(qk.folders, [folderDto("f1", 2, 1, 0), folderDto("f2", 1, 0, 1)]);
  const deleted = qc.getQueryData(qk.folders).find((f) => f.id === "f1");
  const handles = undoable.deleteUndoable({ folders: [deleted] });
  handles.undo();
  assert.deepEqual(ids(qc, qk.bookmarks("f1", "newest")), folderRows.map((row) => row.id));
  assert.deepEqual(ids(qc, qk.libraryIndex(0)), ["b1", "b2", "b3"]);
  assert.deepEqual(ids(qc, qk.search("example")), ["b1", "b2", "b4"]);
  assert.equal(qc.getQueryData(qk.bookmark("b1")).contentHtml, "<p>b1</p>");
  assert.deepEqual(qc.getQueryData(qk.reminders).map((row) => row.id), ["b2"]);
  assert.deepEqual(qc.getQueryData(qk.folders).map((f) => f.id), ["f1", "f2"]);
  await tick();
  assert.deepEqual(state.syncedReminders ?? [], ["b2"]);
  assert.deepEqual(state.journal, []);
});

test("undo reconciles folder counts but does not refetch bookmark lists", () => {
  const { qc, qk, undoable, seed } = setup();
  seed();
  qc.setQueryData(qk.folders, [folderDto("f1", 2, 1)]);
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(5, null, { remindAt: 456 })] });
  handles.undo();
  const queries = qc.getQueryCache().getAll();
  const foldersQuery = qc.getQueryCache().find({ queryKey: qk.folders });
  assert.equal(foldersQuery.state.isInvalidated, true, "folders refetch to reconcile count races");
  for (const query of queries) {
    if (query.queryKey[0] !== "bookmarks" || query.queryKey[1] === "detail") continue;
    assert.equal(query.state.isInvalidated, false, `bookmark list ${JSON.stringify(query.queryKey)} must not refetch after undo`);
  }
});

test("Undo reconciles a search created during the window without refetching old lists", async () => {
  const { qc, qk, undoable, seed, tick } = setup();
  seed();
  const row = bookmark(1, "f1");
  const handles = undoable.deleteUndoable({ bookmarks: [row], showToast: false });
  const key = qk.search("mid-window");
  const payload = { pages: [{ items: [row], nextCursor: null, hasMore: false }], pageParams: [null] };
  qc.setQueryData(key, payload);
  assert.deepEqual(ids(qc, key), [], "the new query respects the pending tombstone");
  let requests = 0;
  const observer = new reactQuery.QueryObserver(qc, { queryKey: key, staleTime: Infinity,
    queryFn: async () => { requests++; return payload; } });
  const unsubscribe = observer.subscribe(() => {});
  handles.undo();
  await tick();
  assert.equal(requests, 1);
  assert.deepEqual(ids(qc, key), [row.id]);
  assert.equal(qc.getQueryState(qk.libraryIndex(0)).isInvalidated, false);
  unsubscribe(); observer.destroy();
});

test("Undo reconciles an existing query refetched with unknown folder rows during the window", async () => {
  const { qc, qk, undoable, seed, tick } = setup();
  seed();
  const handles = undoable.deleteUndoable({ folders: [folderDto("f1", 2, 1)], showToast: false });
  const key = qk.search("example");
  const row = bookmark(8, "f1");
  const payload = { pages: [{ items: [row], nextCursor: null, hasMore: false }], pageParams: [null] };
  qc.setQueryData(key, payload);
  assert.deepEqual(ids(qc, key), []);
  let requests = 0;
  const observer = new reactQuery.QueryObserver(qc, { queryKey: key, staleTime: Infinity,
    queryFn: async () => { requests++; return payload; } });
  const unsubscribe = observer.subscribe(() => {});
  handles.undo(); await tick();
  assert.equal(requests, 1);
  assert.deepEqual(ids(qc, key), [row.id]);
  unsubscribe(); observer.destroy();
});

test("a catalogue changed during the window becomes stale without an Undo refetch storm", async () => {
  const { qc, qk, undoable, seed, tick } = setup();
  seed();
  const handles = undoable.deleteUndoable({ folders: [folderDto("f1", 2, 1)], showToast: false });
  const key = qk.libraryIndex(0);
  const payload = { pages: [{ items: [bookmark(8, "f1")], nextCursor: null, hasMore: false }], pageParams: [null] };
  qc.setQueryData(key, payload);
  let requests = 0;
  const observer = new reactQuery.QueryObserver(qc, { queryKey: key, staleTime: Infinity,
    queryFn: async () => { requests++; return payload; } });
  const unsubscribe = observer.subscribe(() => {});
  handles.undo(); await tick();
  assert.equal(requests, 0);
  assert.equal(qc.getQueryState(key).isInvalidated, true);
  unsubscribe(); observer.destroy();
});

test("Undo preserves an invalidation made during the window without a data write", () => {
  const { qc, qk, undoable, seed } = setup();
  seed();
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(1, "f1")], showToast: false });
  const key = qk.search("example");
  qc.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  handles.undo();
  assert.equal(qc.getQueryState(key).isInvalidated, true);
});

test("Undo reconciles tags on a reader detail first fetched during the window", async () => {
  const { qc, qk, undoable, tick } = setup();
  const tag = { id: "tag1", name: "Tag", color: "blue", bookmarkCount: 1 };
  qc.setQueryData(qk.tags(0), [tag]);
  const handles = undoable.deleteUndoable({ tags: [tag], showToast: false });
  const key = qk.bookmark("b9");
  const row = { ...bookmark(9, null, { tags: [tag] }), contentHtml: "<p>new detail</p>", highlights: [] };
  qc.setQueryData(key, row);
  assert.deepEqual(qc.getQueryData(key).tags, []);
  let requests = 0;
  const observer = new reactQuery.QueryObserver(qc, { queryKey: key, staleTime: Infinity,
    queryFn: async () => { requests++; return row; } });
  const unsubscribe = observer.subscribe(() => {});
  handles.undo(); await tick();
  assert.equal(requests, 1);
  assert.equal(qc.getQueryData(key).tags[0].id, tag.id);
  assert.equal(qc.getQueryData(key).contentHtml, row.contentHtml);
  unsubscribe(); observer.destroy();
});

test("a restored reader snapshot remains stale if a newer detail was suppressed during deletion", () => {
  const { qc, qk, undoable, seed } = setup();
  seed();
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(1, "f1")], showToast: false });
  qc.setQueryData(qk.bookmark("b1"), { ...bookmark(1, "f1"), contentHtml: "<p>new server body</p>" });
  assert.equal(qc.getQueryData(qk.bookmark("b1")), undefined);
  handles.undo();
  assert.equal(qc.getQueryState(qk.bookmark("b1")).isInvalidated, true);
});

test("Undo preserves a kept bookmark's cached reader body if its detail disappears mid-window", () => {
  const { qc, qk, undoable, seed } = setup();
  seed();
  const handles = undoable.deleteUndoable({ folders: [folderDto("f1", 2, 1)], keepIds: ["b1"], showToast: false });
  qc.removeQueries({ queryKey: qk.bookmark("b1"), exact: true });
  handles.undo();
  assert.equal(qc.getQueryData(qk.bookmark("b1")).contentHtml, "<p>b1</p>");
});

test("commit invalidates every bookmark view except the paged library catalogue", async () => {
  const s = setup();
  const { qc, qk, undoable, seed, state, flushed } = s;
  seed();
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")] });
  handles.commit();
  await flushed();
  let catalogueInvalidated = false;
  let otherBookmarksInvalidated = false;
  for (const query of qc.getQueryCache().getAll()) {
    if (!query.state.isInvalidated) continue;
    if (query.queryKey[0] === "bookmarks" && query.queryKey[1] === "library-index") catalogueInvalidated = true;
    if (query.queryKey[0] === "bookmarks" && query.queryKey[1] !== "library-index") otherBookmarksInvalidated = true;
  }
  assert.equal(catalogueInvalidated, false, "catalogue pages must not refetch page by page");
  assert.equal(otherBookmarksInvalidated, true, "folder/search lists still reconcile with the server");
  assert.deepEqual(state.journal, [], "successful replay forgets the intent");
});

test("a late pre-DELETE catalogue response cannot resurrect a committed bookmark", async () => {
  const { qc, qk, undoable, seed, flushed, tick } = setup();
  seed();
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")], showToast: false });
  const key = qk.libraryIndex(0);
  let finish;
  const pending = qc.fetchQuery({ queryKey: key, queryFn: () => new Promise(resolve => { finish = resolve; }) }).catch(() => {});
  handles.commit(); await flushed();
  finish({ pages: [{ items: [bookmark(3, "f2")], nextCursor: null, hasMore: false }], pageParams: [null] });
  await pending; await tick();
  assert.ok(!ids(qc, key).includes("b3"));
  assert.equal(qc.getQueryState(key).isInvalidated, false);
});

test("cancelling an initial catalogue warm fetch restarts only its first page", async () => {
  const { qc, qk, undoable, seed, flushed, tick } = setup();
  seed();
  const key = qk.libraryIndex(0);
  qc.removeQueries({ queryKey: key, exact: true });
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")], showToast: false });
  const payload = { pages: [{ items: [bookmark(1, "f1"), bookmark(2, "f1")], nextCursor: null, hasMore: false }], pageParams: [null] };
  let requests = 0, finish;
  const observer = new reactQuery.QueryObserver(qc, { queryKey: key, queryFn: () => {
    requests++;
    return requests === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(payload);
  } });
  const unsubscribe = observer.subscribe(() => {});
  handles.commit(); await flushed();
  finish({ ...payload, pages: [{ ...payload.pages[0], items: [bookmark(3, "f2")] }] });
  await tick();
  assert.equal(requests, 2, "replace the cancelled first request with one fresh first page");
  assert.deepEqual(ids(qc, key), ["b1", "b2"]);
  unsubscribe(); observer.destroy();
});

test("a kept bookmark returning 404 is not resurrected from its snapshot", async () => {
  const { qc, qk, undoable, seed, state, flushed } = setup();
  seed();
  state.failWith = { method: "bookmarks.update", status: 404 };
  const handles = undoable.deleteUndoable({ folders: [folderDto("f1", 2, 1)], keepIds: ["b1"], showToast: false });
  handles.commit(); await flushed();
  assert.ok(!ids(qc, qk.libraryIndex(0)).includes("b1"));
  assert.ok(!ids(qc, qk.bookmarks(null, "newest")).includes("b1"));
  assert.equal(qc.getQueryData(qk.bookmark("b1")), undefined);
  assert.equal(qc.getQueryState(qk.libraryIndex(0)).isInvalidated, true, "an unavailable keep needs canonical reconciliation");
});

test("partial keep batch responses reconcile each row before the folder cascade", async () => {
  const { qc, qk, undoable, seed, state, api, flushed } = setup();
  seed();
  api.bookmarks.batch = async () => ({ updated: 1 });
  const handles = undoable.deleteUndoable({ folders: [folderDto("f1", 2, 1)], keepIds: ["b1", "b2"], showToast: false });
  handles.commit(); await flushed();
  assert.equal(state.calls.filter(call => call.startsWith("bookmarks.update")).length, 2);
  assert.ok(state.calls.findIndex(call => call.startsWith("folders.remove")) > state.calls.findIndex(call => call.startsWith("bookmarks.update")));
  const kept = qc.getQueryData(qk.libraryIndex(0)).pages.flatMap(page => page.items).filter(row => ["b1", "b2"].includes(row.id));
  assert.equal(kept.length, 2);
  assert.ok(kept.every(row => row.folderId === null));
});

test("mixed bookmark/tag Undo keeps restored reader snapshots stale after tag sweeps", () => {
  const { qc, qk, undoable, seed } = setup();
  const tag = { id: "tag1", name: "Tag", color: "blue", bookmarkCount: 2 };
  const row = bookmark(1, "f1", { tags: [tag] });
  seed({ folderRows: [row, bookmark(2, "f1", { tags: [tag] })] });
  qc.setQueryData(qk.tags(0), [tag]);
  const handles = undoable.deleteUndoable({ bookmarks: [row], tags: [tag], showToast: false });
  handles.undo();
  assert.equal(qc.getQueryState(qk.bookmark("b1")).isInvalidated, true);
  assert.equal(qc.getQueryData(qk.bookmark("b1")).tags[0].id, tag.id);
});

for (const allKept of [false, true]) {
  test(`committing a ${allKept ? "fully" : "partly"} kept folder updates catalogue membership in place`, async () => {
    const { qc, qk, undoable, seed, flushed } = setup();
    const rows = allKept ? [bookmark(1, "f1")] : [bookmark(1, "f1"), bookmark(2, "f1")];
    seed({ folderRows: rows });
    qc.setQueryData(qk.folders, [folderDto("f1", rows.length, rows.length)]);
    const handles = undoable.deleteUndoable({ folders: [folderDto("f1", rows.length, rows.length)], keepIds: ["b1"], showToast: false });
    assert.deepEqual(ids(qc, qk.bookmarks("f1", "newest")), [], "all kept rows also leave the pending folder UI");
    handles.commit(); await flushed();
    const kept = qc.getQueryData(qk.libraryIndex(0)).pages.flatMap(page => page.items).find(row => row.id === "b1");
    assert.equal(kept?.folderId, null);
    assert.ok(ids(qc, qk.bookmarks(null, "newest")).includes("b1"));
    assert.deepEqual(ids(qc, qk.bookmarks("f1", "newest")), []);
    assert.equal(qc.getQueryState(qk.libraryIndex(0)).isInvalidated, false, "known keeps require no full catalogue replay");
  });
}

test("offline replay failure keeps the durable journal and tombstones", async () => {
  const s = setup();
  const { qc, qk, undoable, state, flushed } = s;
  s.seed();
  state.failWith = { method: "bookmarks.remove", status: 503 };
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")] });
  handles.commit();
  await flushed();
  assert.equal(state.journal.length, 1, "intent survives for replay when back online");
  assert.ok(state.toastErrors.some((message) => message.includes("retry when you return online")));
  // A refetch landing during the window must still be tombstoned.
  qc.setQueryData(qk.libraryIndex(0), {
    pages: [{ items: [bookmark(3, "f2"), bookmark(9, null)], nextCursor: null, hasMore: false }],
    pageParams: [null],
  });
  assert.deepEqual(ids(qc, qk.libraryIndex(0)), ["b9"], "refetched rows stay hidden while the delete is pending");
});

test("4xx replay drops the intent, restores rows, and refetches", async () => {
  const s = setup();
  const { qc, qk, undoable, state, flushed } = s;
  s.seed();
  qc.setQueryData(qk.folders, [folderDto("f1", 2, 1)]);
  state.failWith = { method: "folders.remove", status: 403 };
  const deleted = qc.getQueryData(qk.folders).find((f) => f.id === "f1");
  const handles = undoable.deleteUndoable({ folders: [deleted] });
  handles.commit();
  await flushed();
  assert.deepEqual(state.journal, [], "client-error intents never retry forever");
  assert.deepEqual(ids(qc, qk.bookmarks("f1", "newest")), ["b1", "b2"]);
  assert.deepEqual(ids(qc, qk.libraryIndex(0)), ["b1", "b2", "b3"]);
  const foldersQuery = qc.getQueryCache().find({ queryKey: qk.folders });
  assert.equal(foldersQuery.state.isInvalidated, true);
});

test("stripper is a no-op once nothing is pending", () => {
  const { qc, qk, undoable, seed } = setup();
  seed();
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")] });
  handles.undo();
  const key = qk.libraryIndex(0);
  const keyHash = JSON.stringify(key);
  let updates = 0;
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && JSON.stringify(event.query.queryKey) === keyHash) updates += 1;
  });
  const data = qc.getQueryData(key);
  qc.setQueryData(key, { ...data, pages: [{ ...data.pages[0], items: [...data.pages[0].items, bookmark(11, null)] }] });
  unsubscribe();
  assert.equal(updates, 1, "idle cache writes must not trigger a second stripper rewrite");
});

test("resumePendingDeletes strips only dirty queries and finishes the replay", async () => {
  const s = setup();
  const { qc, qk, undoable, flushed } = s;
  s.seed();
  // Confirm journals synchronously; simulate process death before any network
  // by reloading the module against the same cache + journal (new process).
  undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")], showToast: false });
  qc.setQueryData(qk.libraryIndex(0), {
    pages: [{ items: [bookmark(3, "f2"), bookmark(12, null)], nextCursor: null, hasMore: false }],
    pageParams: [null],
  });
  const next = setup({ qc });
  next.state.journal = s.state.journal;
  const untouched = qc.getQueryCache().find({ queryKey: qk.bookmarks(null, "newest") });
  const updatesBefore = untouched.state.dataUpdateCount;
  next.undoable.resumePendingDeletes();
  assert.deepEqual(ids(qc, qk.libraryIndex(0)), ["b12"], "disk-restored rows are tombstoned before paint");
  assert.equal(untouched.state.dataUpdateCount, updatesBefore, "clean queries are not republished");
  await flushed();
  assert.deepEqual(next.state.journal, []);
  assert.ok(next.state.calls.some((call) => call.startsWith("bookmarks.remove")), "durable intent replays");
});

test("kept bookmarks move out before their folder cascades, and undo keeps them home", async () => {
  const s = setup();
  const { qc, qk, undoable, state, flushed } = s;
  s.seed({ folderRows: [bookmark(1, "f1"), bookmark(2, "f1")] });
  qc.setQueryData(qk.folders, [folderDto("f1", 2, 0)]);
  const deleted = qc.getQueryData(qk.folders).find((f) => f.id === "f1");
  const handles = undoable.deleteUndoable({ folders: [deleted], keepIds: ["b1"] });
  // Kept rows are hidden with the folder but never tombstoned standalone.
  assert.deepEqual(ids(qc, qk.bookmarks("f1", "newest")), []);
  handles.undo();
  assert.deepEqual(ids(qc, qk.bookmarks("f1", "newest")).sort(), ["b1", "b2"], "undo restores keeps in place");
  const commitHandles = undoable.deleteUndoable({ folders: [deleted], keepIds: ["b1"] });
  commitHandles.commit();
  await flushed();
  const moveBeforeFolderDelete = state.calls.findIndex((call) => call.startsWith("bookmarks.update") || call.startsWith("bookmarks.batch"));
  const folderDelete = state.calls.findIndex((call) => call.startsWith("folders.remove"));
  assert.ok(moveBeforeFolderDelete !== -1 && folderDelete !== -1 && moveBeforeFolderDelete < folderDelete,
    "kept bookmarks leave the folder before it is deleted");
});

test("overlapping deletes stay isolated: undoing one keeps the other hidden", () => {
  const { qc, qk, undoable, seed } = setup();
  seed();
  const first = undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")] });
  const second = undoable.deleteUndoable({ bookmarks: [bookmark(5, null)] });
  second.undo();
  assert.deepEqual(ids(qc, qk.libraryIndex(0)).sort(), ["b1", "b2"], "first delete stays hidden; second's row never reached the catalogue");
  first.undo();
  assert.deepEqual(ids(qc, qk.libraryIndex(0)).sort(), ["b1", "b2", "b3"]);
});

test("tag deletes propagate to assigned and suggested tags everywhere, and undo restores both", () => {
  const { qc, qk, undoable } = setup();
  const tag = { id: "tag1", name: "T1", color: "blue", bookmarkCount: 2 };
  const assigned = bookmark(1, null, { tags: [tag], suggestedTags: [tag] });
  const paged = (items) => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] });
  qc.setQueryData(qk.bookmarks(null, "newest"), paged([assigned, bookmark(2, null)]));
  qc.setQueryData(qk.libraryIndex(0), paged([assigned, bookmark(2, null)]));
  qc.setQueryData(qk.bookmark(assigned.id), { ...assigned, contentHtml: "<p>x</p>", highlights: [] });
  for (const revision of [0, 1]) qc.setQueryData(qk.tags(revision), [tag]);
  const handles = undoable.deleteUndoable({ tags: [tag] });
  for (const key of [qk.bookmarks(null, "newest"), qk.libraryIndex(0)]) {
    for (const item of ids(qc, key).length ? qc.getQueryData(key).pages[0].items : []) {
      assert.deepEqual(item.tags, [], `assigned tag stripped in ${JSON.stringify(key)}`);
      assert.deepEqual(item.suggestedTags, [], `suggested tag stripped in ${JSON.stringify(key)}`);
    }
  }
  assert.deepEqual(qc.getQueryData(qk.tags(0)), []);
  handles.undo();
  const restored = qc.getQueryData(qk.bookmarks(null, "newest")).pages[0].items[0];
  assert.deepEqual(restored.tags, [{ id: "tag1", name: "T1", color: "blue" }], "bookmark rows carry tag summaries");
  assert.deepEqual(restored.suggestedTags, [{ id: "tag1", name: "T1", color: "blue" }]);
  assert.deepEqual(qc.getQueryData(qk.tags(1)), [tag], "catalogue restores the full tag row with counts");
  assert.equal(qc.getQueryData(qk.bookmark(assigned.id)).contentHtml, "<p>x</p>");
});

test("a changed session scope refuses to settle or restore", () => {
  const { qc, qk, undoable, seed, state } = setup();
  seed();
  const handles = undoable.deleteUndoable({ bookmarks: [bookmark(3, "f2")] });
  state.scopeCurrent = false;
  const settled = handles.undo();
  assert.equal(settled, false);
  assert.deepEqual(ids(qc, qk.libraryIndex(0)).sort(), ["b1", "b2"].sort(), "rows stay hidden until the new session owns them");
});

test("standalone deletes dedupe against already-pending rows and contained sets", () => {
  const { qc, qk, undoable, seed, state } = setup();
  seed();
  const row = bookmark(3, "f2");
  undoable.deleteUndoable({ bookmarks: [row] });
  undoable.deleteUndoable({ bookmarks: [row] });
  assert.equal(state.journal.length, 1, "double-submitting the same row records one intent");
});
