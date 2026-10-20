/** Run with: node --test apps/mobile/scripts/bookmark-write-invalidation.test.cjs
 *
 * Guards the settled invalidation of bookmark writes against replaying the
 * warmed whole-library catalogue (the `library-index` infinite query). A
 * 10k-bookmark library is ~100 catalogue pages; invalidating that prefix after
 * every move/delete refetched all of them. Move/delete callbacks reconcile the
 * catalogue in place, while tag/read actions need canonical rows and must keep
 * the broad invalidation.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const reactQuery = require("@tanstack/react-query");

const FOLDER_A = "folder-a";
const FOLDER_B = "folder-b";

function bookmark(id, folderId, createdAt, extra = {}) {
  return {
    id,
    title: `Bookmark ${id}`,
    url: `https://example.com/${id}`,
    domain: "example.com",
    description: null,
    createdAt,
    updatedAt: createdAt,
    isRead: false,
    tags: [],
    suggestedTags: [],
    folderId,
    fetchStatus: "ok",
    contentKind: "web",
    remindAt: null,
    ...extra,
  };
}

function paged(items) {
  return { pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] };
}

/** Five warmed catalogue pages, like a partly precached 10k library. */
function catalogue(rows) {
  return {
    pages: rows.map(([items, cursor]) => ({ items, nextCursor: cursor, hasMore: cursor != null })),
    pageParams: [null, "c1", "c2", "c3", "c4"],
  };
}

// The real mutation callbacks, cache walkers, and QueryClient; only native
// storage/network/session modules are stubbed out.
function setup() {
  const qc = new reactQuery.QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const mod = { exports: {} };
    modules.set(filename, mod);
    const localRequire = (name) => {
      if (name === "@tanstack/react-query") return { ...reactQuery, useQueryClient: () => qc };
      // Callbacks are what matters here, not the native-session wrapper.
      if (name === "./use-session-mutation") return { useSessionMutation: (options) => options };
      if (name === "../lib/session-scope") return {
        captureSessionScope: () => ({ server: "https://example.test", generation: 1 }),
        isSessionScopeCurrent: () => true,
        assertSessionScope: () => {},
      };
      if (name === "../lib/api/bookmarks") return { bookmarksApi: {} };
      if (name === "../lib/query-client") return { queryClient: qc };
      if (name === "../store/folder-tokens") return {
        useFolderTokenStore: { getState: () => ({ get: () => undefined, accessRevision: 0 }) },
      };
      if (name === "../store/list-sort") return {
        useListSortStore: { getState: () => ({ bookmarkSort: () => "newest", unfiledSort: "newest" }) },
      };
      if (name === "../lib/undoable-delete") return {};
      if (name === "../lib/query-persist") return { PERSISTED_QUERY_GC_TIME_MS: Infinity };
      if (name.startsWith(".")) return load(resolve(dirname(filename), `${name}.ts`));
      return require(name);
    };
    new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
    return mod.exports;
  }

  const { qk } = load(resolve(__dirname, "../src/lib/api/query-keys.ts"));
  const { useMoveBookmark, useBatchBookmarks } = load(resolve(__dirname, "../src/hooks/use-bookmarks.ts"));

  const rows = {
    b1: bookmark("b1", FOLDER_A, "2026-10-05T00:00:00.000Z"),
    b2: bookmark("b2", FOLDER_B, "2026-10-04T00:00:00.000Z"),
    b3: bookmark("b3", FOLDER_A, "2026-10-03T00:00:00.000Z"),
    b4: bookmark("b4", FOLDER_B, "2026-10-02T00:00:00.000Z"),
    b5: bookmark("b5", FOLDER_B, "2026-10-01T00:00:00.000Z"),
  };
  const folders = () => [
    { id: FOLDER_A, name: "A", bookmarkCount: 2, unreadCount: 2, pinned: false, protected: false },
    { id: FOLDER_B, name: "B", bookmarkCount: 3, unreadCount: 3, pinned: false, protected: false },
  ];
  const listA = qk.bookmarks(FOLDER_A, "newest");
  const listB = qk.bookmarks(FOLDER_B, "newest");
  const indexKey = qk.libraryIndex(0);

  qc.setQueryData(qk.folders, folders());
  qc.setQueryData(qk.tags(0), [{ id: "tag", name: "Tag", color: "blue", bookmarkCount: 2 }]);
  qc.setQueryData(listA, paged([rows.b1, rows.b3]));
  qc.setQueryData(listB, paged([rows.b2]));
  qc.setQueryData(qk.bookmark("b1"), { ...rows.b1, contentHtml: "<p>body</p>" });
  qc.setQueryData(indexKey, catalogue([
    [[rows.b1], "c1"],
    [[rows.b2], "c2"],
    [[rows.b3], "c3"],
    [[rows.b4], "c4"],
    [[rows.b5], null],
  ]));

  const query = (key) => qc.getQueryCache().find({ queryKey: key, exact: true });
  const invalidated = (key) => query(key)?.state.isInvalidated === true;
  const items = (key) => qc.getQueryData(key).pages.flatMap((page) => page.items);
  const counts = () => Object.fromEntries(
    qc.getQueryData(qk.folders).map((folder) => [folder.id, [folder.bookmarkCount, folder.unreadCount]]),
  );
  return {
    qc, qk, useMoveBookmark, useBatchBookmarks, rows, folders, listA, listB, indexKey,
    query, invalidated, items, counts,
  };
}

/** A subscribed catalogue query counts replays; fresh seeded data is not fetched. */
function watchCatalogue(qc, queryKey, data) {
  qc.setQueryData(queryKey, data);
  const calls = { count: 0 };
  const observer = new reactQuery.QueryObserver(qc, {
    queryKey,
    queryFn: async () => {
      calls.count += 1;
      return data;
    },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  return { calls, unsubscribe };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("single move invalidates lists/folders but replays no warmed catalogue page", async () => {
  const s = setup();
  const data = s.qc.getQueryData(s.indexKey);
  const watch = watchCatalogue(s.qc, s.indexKey, data);
  const mutation = s.useMoveBookmark(FOLDER_A);
  const variables = { id: "b1", toFolderId: FOLDER_B };

  const context = await mutation.onMutate(variables);
  assert.ok(context);
  assert.deepEqual(s.items(s.listA).map((row) => row.id), ["b3"]);
  assert.deepEqual(new Set(s.items(s.listB).map((row) => row.id)), new Set(["b1", "b2"]));
  assert.deepEqual(s.counts(), { [FOLDER_A]: [1, 1], [FOLDER_B]: [4, 4] });
  assert.equal(s.items(s.indexKey).find((row) => row.id === "b1").folderId, FOLDER_B);

  const updated = {
    ...s.rows.b1,
    folderId: FOLDER_B,
    title: "Canonical title",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
  await mutation.onSuccess(updated);
  mutation.onSettled(updated, null, variables);

  assert.equal(s.invalidated(s.listA), true, "source list still replays");
  assert.equal(s.invalidated(s.listB), true, "destination list still replays");
  assert.equal(s.invalidated(s.qk.folders), true, "folder counts still replay");
  assert.equal(s.invalidated(s.indexKey), false, "catalogue was reconciled in place");

  const indexRows = s.items(s.indexKey);
  assert.equal(indexRows.length, 5, "all warmed pages stay cached");
  assert.equal(indexRows.find((row) => row.id === "b1").folderId, FOLDER_B);
  assert.equal(indexRows.find((row) => row.id === "b1").title, "Canonical title");
  await tick();
  assert.equal(watch.calls.count, 0, "no catalogue page request");
  watch.unsubscribe();
});

test("failed move restores catalogue membership and skips its replay", async () => {
  const s = setup();
  const data = s.qc.getQueryData(s.indexKey);
  const watch = watchCatalogue(s.qc, s.indexKey, data);
  const mutation = s.useMoveBookmark(FOLDER_A);
  const variables = { id: "b1", toFolderId: FOLDER_B };

  const context = await mutation.onMutate(variables);
  await mutation.onError(new Error("Offline"), variables, context);
  assert.deepEqual(s.items(s.listA).map((row) => row.id), ["b1", "b3"]);
  assert.deepEqual(s.items(s.listB).map((row) => row.id), ["b2"]);
  assert.deepEqual(s.counts(), { [FOLDER_A]: [2, 2], [FOLDER_B]: [3, 3] });
  assert.equal(s.items(s.indexKey).find((row) => row.id === "b1").folderId, FOLDER_A);

  mutation.onSettled(undefined, new Error("Offline"), variables);
  assert.equal(s.invalidated(s.listA), true);
  assert.equal(s.invalidated(s.qk.folders), true);
  assert.equal(s.invalidated(s.indexKey), false);
  await tick();
  assert.equal(watch.calls.count, 0);
  watch.unsubscribe();
});

test("batch move invalidates lists/folders but replays no warmed catalogue page", async () => {
  const s = setup();
  const data = s.qc.getQueryData(s.indexKey);
  const watch = watchCatalogue(s.qc, s.indexKey, data);
  const mutation = s.useBatchBookmarks();
  const variables = { action: "move", ids: ["b1", "b3"], folderId: FOLDER_B, scopeFolderId: FOLDER_A };

  await mutation.onMutate(variables);
  await mutation.onSuccess({ updated: 2 }, variables);
  assert.deepEqual(s.items(s.listA), []);
  assert.deepEqual(new Set(s.items(s.listB).map((row) => row.id)), new Set(["b1", "b2", "b3"]));
  assert.deepEqual(s.counts(), { [FOLDER_A]: [0, 0], [FOLDER_B]: [5, 5] });
  const indexRows = s.items(s.indexKey);
  assert.deepEqual(
    indexRows.filter((row) => row.id === "b1" || row.id === "b3").map((row) => row.folderId),
    [FOLDER_B, FOLDER_B],
  );

  mutation.onSettled({ updated: 2 }, null, variables);
  assert.equal(s.invalidated(s.listA), true);
  assert.equal(s.invalidated(s.listB), true);
  assert.equal(s.invalidated(s.qk.folders), true);
  assert.equal(s.invalidated(s.qk.tags(0)), false, "a move changes no tag catalogue");
  assert.equal(s.invalidated(s.indexKey), false);
  await tick();
  assert.equal(watch.calls.count, 0);
  watch.unsubscribe();
});

test("batch delete removes catalogue rows in place without replaying its pages", async () => {
  const s = setup();
  const data = s.qc.getQueryData(s.indexKey);
  const watch = watchCatalogue(s.qc, s.indexKey, data);
  const mutation = s.useBatchBookmarks();
  const variables = { action: "delete", ids: ["b1", "b2"], scopeFolderId: FOLDER_A };

  await mutation.onMutate(variables);
  assert.deepEqual(s.items(s.listA).map((row) => row.id), ["b3"]);
  assert.deepEqual(s.items(s.listB).map((row) => row.id), []);
  assert.deepEqual(s.items(s.indexKey).map((row) => row.id), ["b3", "b4", "b5"]);

  mutation.onSettled({ updated: 2 }, null, variables);
  assert.equal(s.invalidated(s.listA), true);
  assert.equal(s.invalidated(s.listB), true);
  assert.equal(s.invalidated(s.qk.folders), true, "folder counts still refresh after a delete");
  assert.equal(s.invalidated(s.qk.tags(0)), true, "tag counts still refresh after a delete");
  assert.equal(s.invalidated(s.indexKey), false);
  await tick();
  assert.equal(watch.calls.count, 0);
  watch.unsubscribe();
});

test("addTags still invalidates and replays the catalogue", async () => {
  const s = setup();
  const data = s.qc.getQueryData(s.indexKey);
  const watch = watchCatalogue(s.qc, s.indexKey, data);
  const mutation = s.useBatchBookmarks();
  const variables = { action: "addTags", ids: ["b1"], tagIds: ["tag"], scopeFolderId: FOLDER_A };

  await mutation.onMutate(variables);
  // addTags has no optimistic metadata patch; the catalogue must refetch.
  assert.equal(s.items(s.indexKey).find((row) => row.id === "b1").tags.length, 0);
  await mutation.onSuccess({ updated: 1 }, variables);
  mutation.onSettled({ updated: 1 }, null, variables);

  assert.equal(s.invalidated(s.indexKey), true);
  assert.equal(s.invalidated(s.listA), true);
  assert.equal(s.invalidated(s.qk.folders), true);
  assert.equal(s.invalidated(s.qk.tags(0)), true);
  await tick();
  assert.equal(watch.calls.count, 1, "catalogue refetches after a tag write");
  watch.unsubscribe();
});

test("failed batch delete reconciles the catalogue after snapshot rollback", async () => {
  const s = setup();
  const mutation = s.useBatchBookmarks();
  const variables = { action: "delete", ids: ["b1"], scopeFolderId: FOLDER_A };
  const context = await mutation.onMutate(variables);
  const error = new Error("Delete rejected");
  await mutation.onError(error, variables, context);
  mutation.onSettled(undefined, error, variables);
  assert.equal(s.invalidated(s.indexKey), true, "snapshot rollback may have overwritten concurrent canonical metadata");
  assert.equal(s.invalidated(s.listA), true);
});

test("the last move preserves an earlier overlapping tag write's catalogue reconciliation", () => {
  const s = setup();
  const tags = s.useBatchBookmarks(), move = s.useMoveBookmark(FOLDER_A);
  s.qc.isMutating = () => 2;
  tags.onSettled({ updated: 1 }, null, { action: "addTags", ids: ["b1"], tagIds: ["tag"] });
  assert.equal(s.invalidated(s.indexKey), false, "wait for the remaining optimistic move");
  s.qc.isMutating = () => 1;
  move.onSettled();
  assert.equal(s.invalidated(s.indexKey), true, "the final move must not lose the tag reconciliation request");
  s.qc.setQueryData(s.indexKey, s.qc.getQueryData(s.indexKey));
  move.onSettled();
  assert.equal(s.invalidated(s.indexKey), false, "the reconciliation request is consumed exactly once");
});

test("markRead still invalidates the catalogue for canonical rows", async () => {
  const s = setup();
  const mutation = s.useBatchBookmarks();
  const variables = { action: "markRead", ids: ["b1"], scopeFolderId: FOLDER_A };

  await mutation.onMutate(variables);
  assert.equal(s.items(s.indexKey).find((row) => row.id === "b1").isRead, true);
  await mutation.onSuccess({ updated: 1 }, variables);
  mutation.onSettled({ updated: 1 }, null, variables);

  assert.equal(s.invalidated(s.indexKey), true, "read writes need canonical server fields");
  assert.equal(s.invalidated(s.listA), true);
  assert.equal(s.invalidated(s.qk.folders), true);
  assert.equal(s.invalidated(s.qk.tags(0)), false);
});

test("overlapping single move skips premature list/folder/catalogue invalidations", async () => {
  const s = setup();
  const mutation = s.useMoveBookmark(FOLDER_A);
  const variables = { id: "b1", toFolderId: FOLDER_B };
  const context = await mutation.onMutate(variables);
  const updated = { ...s.rows.b1, folderId: FOLDER_B };
  await mutation.onSuccess(updated);

  const realIsMutating = s.qc.isMutating.bind(s.qc);
  s.qc.isMutating = () => 2;
  mutation.onSettled(updated, null, variables);
  assert.equal(s.invalidated(s.listA), false);
  assert.equal(s.invalidated(s.listB), false);
  assert.equal(s.invalidated(s.qk.folders), false);
  assert.equal(s.invalidated(s.indexKey), false);

  s.qc.isMutating = realIsMutating;
  mutation.onSettled(updated, null, variables);
  assert.equal(s.invalidated(s.listA), true);
  assert.equal(s.invalidated(s.listB), true);
  assert.equal(s.invalidated(s.qk.folders), true);
  assert.equal(s.invalidated(s.indexKey), false);
  assert.ok(context);
});

test("overlapping batch move skips premature list/folder/catalogue invalidations", async () => {
  const s = setup();
  const mutation = s.useBatchBookmarks();
  const variables = { action: "move", ids: ["b1"], folderId: FOLDER_B, scopeFolderId: FOLDER_A };
  await mutation.onMutate(variables);
  await mutation.onSuccess({ updated: 1 }, variables);

  const realIsMutating = s.qc.isMutating.bind(s.qc);
  s.qc.isMutating = () => 2;
  mutation.onSettled({ updated: 1 }, null, variables);
  assert.equal(s.invalidated(s.listA), false);
  assert.equal(s.invalidated(s.listB), false);
  assert.equal(s.invalidated(s.qk.folders), false);
  assert.equal(s.invalidated(s.indexKey), false);

  s.qc.isMutating = realIsMutating;
  mutation.onSettled({ updated: 1 }, null, variables);
  assert.equal(s.invalidated(s.listA), true);
  assert.equal(s.invalidated(s.listB), true);
  assert.equal(s.invalidated(s.qk.folders), true);
  assert.equal(s.invalidated(s.indexKey), false);
});
