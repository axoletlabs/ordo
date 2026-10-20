/** Run with: node --test apps/mobile/scripts/query-persist-budget.test.cjs
 *
 * Guards the persisted-snapshot budget in src/lib/query-persist.ts: the disk
 * snapshot keeps the folders catalogue, the default-sort unfiled list, and a
 * recency-bounded set of other lists under a total-rows cap. A save used to
 * serialize every visited folder/sort list synchronously (measured 7.9 MB /
 * 32.6 ms after visiting 60 folders); the RAM query cache is never trimmed.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const shared = require("@ordo/shared");
const reactQuery = require("@tanstack/react-query");
const { persistQueryClientSave } = require("@tanstack/react-query-persist-client");

function load(path, stubs = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  const requireModule = (name) => {
    if (stubs[name]) return stubs[name];
    if (name === "@ordo/shared") return shared;
    return require(name.startsWith("@ordo") ? resolve(__dirname, "../node_modules", name) : name);
  };
  new Function("require", "module", "exports", outputText)(requireModule, module, module.exports);
  return module.exports;
}

const qp = load("lib/query-persist.ts");

const ROWS_PER_PAGE = 100;
const DEFAULT_SORT = shared.DEFAULT_BOOKMARK_LIST_SORT; // "newest" — session sorts reboot to this

function page(base, count = ROWS_PER_PAGE) {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      id: `bm-${base}-${i}`,
      title: `Bookmark ${base}-${i}`,
      url: `https://example.com/${base}/${i}`,
      domain: "example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      isRead: false,
      tags: [],
      suggestedTags: [],
      folderId: null,
      fetchStatus: "ok",
      contentKind: "web",
      remindAt: null,
    })),
    nextCursor: null,
    hasMore: false,
  };
}

function listQuery(folderId, sort, dataUpdatedAt, pages = 1, rowCount = ROWS_PER_PAGE) {
  return {
    queryKey: ["bookmarks", folderId, sort],
    state: {
      data: { pages: Array.from({ length: pages }, (_, p) => page(`${folderId ?? "unfiled"}-${sort}-${p}`, rowCount)), pageParams: Array.from({ length: pages }, (_, p) => (p === 0 ? null : `c${p}`)) },
      dataUpdatedAt,
      status: "success",
    },
  };
}

function foldersQuery(protectedIds = []) {
  return {
    queryKey: ["folders"],
    state: {
      data: [0, 1, 2, 3, 4].map((i) => ({
        id: `folder-${i}`,
        name: `Folder ${i}`,
        protected: protectedIds.includes(`folder-${i}`),
        pinned: false,
        bookmarkCount: 5,
        unreadCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      })),
      dataUpdatedAt: 5_000,
      status: "success",
    },
  };
}

function snapshot(queries) {
  return { timestamp: 1_000, buster: qp.QUERY_CACHE_BUSTER, clientState: { mutations: [{ fake: true }], queries } };
}

function keysOf(client) {
  return client.clientState.queries.map((query) => JSON.stringify(query.queryKey));
}

function rowsOf(client) {
  let rows = 0;
  for (const query of client.clientState.queries) {
    if (!qp.isPersistedBookmarkListKey(query.queryKey)) continue;
    for (const page of query.state?.data?.pages ?? []) rows += page.items.length;
  }
  return rows;
}

test("sanitize does not mutate its input, including trimmed entries", () => {
  const input = snapshot([
    foldersQuery(),
    listQuery(null, DEFAULT_SORT, 900, 5), // deep-scrolled home list
    listQuery("folder-1", DEFAULT_SORT, 800),
    listQuery("folder-2", DEFAULT_SORT, 700),
  ]);
  const before = structuredClone(input);
  const output = qp.sanitizePersistedClient(input);
  assert.deepEqual(input, before, "input snapshot is untouched");
  assert.notEqual(output, input, "returns a new client object");
  const deep = output.clientState.queries.find((query) => query.queryKey[1] === null);
  assert.equal(deep.state.data.pages.length, qp.MAX_PERSISTED_LIST_PAGES, "home list trimmed in the output");
  assert.equal(input.clientState.queries[1].state.data.pages.length, 5, "input pages array still intact");
  assert.deepEqual(output.clientState.mutations, [], "mutations never reach disk");
});

test("recency selection is newest-first and deterministic across input order and ties", () => {
  const build = (order) =>
    snapshot([
      foldersQuery(),
      ...order.map((i) => listQuery(`folder-${i}`, DEFAULT_SORT, 1_000 + i)),
    ]);
  const straight = qp.sanitizePersistedClient(build([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  const shuffled = qp.sanitizePersistedClient(build([7, 2, 9, 0, 5, 3, 8, 1, 6, 4]));
  assert.equal(
    straight.clientState.queries.filter((query) => qp.isPersistedBookmarkListKey(query.queryKey)).length,
    qp.MAX_PERSISTED_RECENT_LISTS,
    "count cap applied to folder lists",
  );
  assert.deepEqual(keysOf(straight).slice().sort(), keysOf(shuffled).slice().sort(), "input order does not change the kept set");

  // All-tied timestamps resolve by key order, not insertion order.
  const tied = qp.sanitizePersistedClient(
    snapshot([foldersQuery(), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => listQuery(`folder-${i}`, DEFAULT_SORT, 42))]),
  );
  const tiedShuffled = qp.sanitizePersistedClient(
    snapshot([foldersQuery(), ...[9, 4, 1, 7, 0, 3, 8, 2, 6, 5].map((i) => listQuery(`folder-${i}`, DEFAULT_SORT, 42))]),
  );
  assert.deepEqual(keysOf(tied).slice().sort(), keysOf(tiedShuffled).slice().sort(), "ties are broken deterministically");
  assert.equal(
    tied.clientState.queries.length,
    1 + qp.MAX_PERSISTED_RECENT_LISTS,
    "folders catalogue + capped lists",
  );

  // Idempotent: sanitizing the sanitized snapshot keeps the same set.
  assert.deepEqual(keysOf(qp.sanitizePersistedClient(tied)).sort(), keysOf(tied).sort(), "second pass is stable");
});

test("unfiled variants: default sort is essential, other sorts compete in the pool", () => {
  const ancientDefault = listQuery(null, DEFAULT_SORT, 1, 2);
  const output = qp.sanitizePersistedClient(
    snapshot([
      foldersQuery(),
      ancientDefault,
      ...Array.from({ length: qp.MAX_PERSISTED_RECENT_LISTS + 2 }, (_, i) => listQuery(`folder-${i}`, DEFAULT_SORT, 9_000 + i)),
      listQuery(null, "title", 100),
      listQuery(null, "oldest", 50),
    ]),
  );
  const keys = keysOf(output);
  assert.ok(keys.includes(JSON.stringify(["bookmarks", null, DEFAULT_SORT])), "cold-boot unfiled list always kept");
  assert.ok(!keys.includes(JSON.stringify(["bookmarks", null, "title"])), "non-default unfiled sort out-recency'd");
  assert.ok(!keys.includes(JSON.stringify(["bookmarks", null, "oldest"])), "older unfiled sort dropped");
  assert.equal(
    output.clientState.queries.filter((query) => qp.isPersistedBookmarkListKey(query.queryKey)).length,
    1 + qp.MAX_PERSISTED_RECENT_LISTS,
    "default unfiled + capped pool",
  );

  // A non-default unfiled sort survives when it is genuinely recent.
  const recentSort = qp.sanitizePersistedClient(
    snapshot([foldersQuery(), listQuery(null, DEFAULT_SORT, 10), listQuery(null, "title", 9_999)]),
  );
  assert.ok(keysOf(recentSort).includes(JSON.stringify(["bookmarks", null, "title"])), "recent non-default sort kept");
});

test("total-rows budget drops older lists even under the count cap", () => {
  const listRows = ROWS_PER_PAGE * qp.MAX_PERSISTED_LIST_PAGES; // fully-trimmed list = 300 rows
  assert.ok(qp.MAX_PERSISTED_LIST_ROWS % listRows === 0, "fixture assumes full-size lists");
  // 1 essential home list + N pool lists fit exactly; the count cap is higher,
  // so the rows budget is what stops selection.
  const poolListsThatFit = qp.MAX_PERSISTED_LIST_ROWS / listRows - 1;
  assert.ok(poolListsThatFit < qp.MAX_PERSISTED_RECENT_LISTS, "rows cap binds before count cap in this fixture");
  const queries = [foldersQuery(), listQuery(null, DEFAULT_SORT, 5, qp.MAX_PERSISTED_LIST_PAGES)];
  for (let i = 0; i < poolListsThatFit + 3; i++) {
    queries.push(listQuery(`folder-${i}`, DEFAULT_SORT, 10_000 - i, qp.MAX_PERSISTED_LIST_PAGES));
  }
  const output = qp.sanitizePersistedClient(snapshot(queries));
  const keptLists = output.clientState.queries.filter((query) => qp.isPersistedBookmarkListKey(query.queryKey));
  assert.equal(keptLists.length, 1 + poolListsThatFit, "rows budget binds before the count cap");
  assert.equal(rowsOf(output), qp.MAX_PERSISTED_LIST_ROWS, "snapshot rows exactly at budget");
  assert.ok(keysOf(output).includes(JSON.stringify(["bookmarks", `folder-0`, DEFAULT_SORT])), "newest folder kept");
  assert.ok(!keysOf(output).includes(JSON.stringify(["bookmarks", `folder-${poolListsThatFit}`, DEFAULT_SORT])), "oldest folders dropped at the boundary");
});

test("malformed snapshots never throw and degrade to safe defaults", () => {
  const bare = qp.sanitizePersistedClient({ timestamp: 1, buster: qp.QUERY_CACHE_BUSTER });
  assert.deepEqual(bare.clientState.queries, [], "missing clientState yields no queries");

  const weird = qp.sanitizePersistedClient(
    snapshot([
      null,
      { queryKey: "folders", state: null }, // wrong key shape: not the folders list
      { queryKey: ["folders"], state: { dataUpdatedAt: "yesterday" } }, // folders without data
      { queryKey: ["bookmarks", null, DEFAULT_SORT] }, // no state at all
      { queryKey: ["bookmarks", null, "bogus-sort"], state: { data: { pages: "no" }, dataUpdatedAt: 3 } },
      { queryKey: ["bookmarks", "folder-1", DEFAULT_SORT], state: { data: { pages: [{ items: "nope" }] }, dataUpdatedAt: 4 } },
      foldersQuery(),
    ]),
  );
  assert.ok(Array.isArray(weird.clientState.queries), "output stays well-formed");
  assert.ok(keysOf(weird).includes(JSON.stringify(["folders"])), "folders catalogue kept");

  // Missing/invalid dataUpdatedAt ranks as oldest: when the pool must drop
  // someone, the invalid-timestamp entry loses to every real timestamp.
  const valid = Array.from({ length: qp.MAX_PERSISTED_RECENT_LISTS }, (_, i) => listQuery(`folder-${100 + i}`, DEFAULT_SORT, 10 + i));
  const ranked = qp.sanitizePersistedClient(
    snapshot([
      foldersQuery(),
      { queryKey: ["bookmarks", "folder-1", DEFAULT_SORT], state: { data: { pages: [page("a")] }, dataUpdatedAt: "not-a-number" } },
      ...valid,
    ]),
  );
  const keys = keysOf(ranked);
  assert.equal(keys.filter((key) => key.startsWith('["bookmarks"')).length, qp.MAX_PERSISTED_RECENT_LISTS, "pool filled entirely by valid-timestamp lists");
  assert.ok(!keys.includes(JSON.stringify(["bookmarks", "folder-1", DEFAULT_SORT])), "invalid timestamp treated as oldest and dropped first");
});

test("privacy: protected and reserved keys never reach disk and never spend budget", () => {
  const protectedList = listQuery("folder-0", DEFAULT_SORT, 99_999); // newest of everything
  const reserved = [
    { queryKey: ["bookmarks", "library-index", 0], state: { data: { pages: [page("idx")] }, dataUpdatedAt: 99_998 } },
    { queryKey: ["bookmarks", "search", "hello", [], "all", [], false, false, "all"], state: { data: { pages: [page("search")] }, dataUpdatedAt: 99_997 } },
    { queryKey: ["bookmarks", "tagged", ["t1"]], state: { data: { pages: [page("tagged")] }, dataUpdatedAt: 99_996 } },
    { queryKey: ["bookmarks", "detail", "bm-1"], state: { data: { id: "bm-1" }, dataUpdatedAt: 99_995 } },
    { queryKey: ["bookmarks", "extraction-progress"], state: { data: { pending: 0 }, dataUpdatedAt: 99_994 } },
  ];
  const eligible = Array.from({ length: qp.MAX_PERSISTED_RECENT_LISTS + 1 }, (_, i) =>
    listQuery(`folder-${i + 1}`, DEFAULT_SORT, 5_000 + i),
  );
  const output = qp.sanitizePersistedClient(
    snapshot([foldersQuery(["folder-0"]), protectedList, ...reserved, ...eligible, listQuery(null, DEFAULT_SORT, 1)]),
  );
  const keys = keysOf(output);
  assert.ok(!keys.includes(JSON.stringify(["bookmarks", "folder-0", DEFAULT_SORT])), "protected folder list never persisted");
  for (const key of reserved) assert.ok(!keys.includes(JSON.stringify(key.queryKey)), `reserved key excluded: ${JSON.stringify(key.queryKey.slice(0, 2))}`);
  assert.equal(
    output.clientState.queries.filter((query) => query.queryKey[0] === "bookmarks" && typeof query.queryKey[1] === "string").length,
    qp.MAX_PERSISTED_RECENT_LISTS,
    "protected/reserved entries did not consume pool slots",
  );
  assert.ok(keys.includes(JSON.stringify(["folders"])), "folders catalogue persisted");
  assert.ok(keys.includes(JSON.stringify(["bookmarks", null, DEFAULT_SORT])), "cold-boot list persisted");

  // No folders catalogue at all: named folders are never persisted (lock state unknowable).
  const noCatalogue = qp.sanitizePersistedClient(snapshot([listQuery("folder-2", DEFAULT_SORT, 9_999), listQuery(null, DEFAULT_SORT, 1)]));
  assert.deepEqual(
    keysOf(noCatalogue),
    [JSON.stringify(["bookmarks", null, DEFAULT_SORT])],
    "unfiled-only fallback preserved",
  );
});

test("sanitized snapshots restore through the real persister shape", () => {
  let stored = null;
  const persister = qp.createSnapshotPersister(
    { getString: () => stored, set: (_key, value) => { stored = value; }, remove: () => { stored = null; } },
    "ordo.rq.test",
  );
  const input = snapshot([
    foldersQuery(["folder-0"]),
    listQuery(null, DEFAULT_SORT, 900, 5),
    listQuery("folder-1", DEFAULT_SORT, 800),
    listQuery("folder-0", DEFAULT_SORT, 9_999), // protected: must not round-trip
  ]);
  persister.persistClient(input);
  assert.ok(stored, "snapshot serialized");
  const restored = persister.restoreClient();
  assert.equal(restored.buster, input.buster, "buster preserved");
  assert.equal(restored.timestamp, input.timestamp, "timestamp preserved");
  const restoredKeys = restored.clientState.queries.map((query) => JSON.stringify(query.queryKey));
  assert.ok(restoredKeys.includes(JSON.stringify(["folders"])), "folders restored");
  assert.ok(restoredKeys.includes(JSON.stringify(["bookmarks", null, DEFAULT_SORT])), "cold-boot list restored");
  assert.ok(!restoredKeys.includes(JSON.stringify(["bookmarks", "folder-0", DEFAULT_SORT])), "protected list not restored");
  for (const query of restored.clientState.queries) {
    assert.equal(query.state.isInvalidated, true, "disk data is never treated as fresh");
    if (qp.isPersistedBookmarkListKey(query.queryKey)) {
      assert.ok(query.state.data.pages.length <= qp.MAX_PERSISTED_LIST_PAGES, "pages trimmed");
      assert.equal(query.state.data.pageParams.length, query.state.data.pages.length, "pageParams aligned with pages");
    }
  }
});

test("real save bounds the snapshot and leaves the RAM cache untouched", async () => {
  const qc = new reactQuery.QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const visited = 30;
  qc.setQueryData(["folders"], foldersQuery(["folder-0"]).state.data);
  qc.setQueryData(["bookmarks", null, DEFAULT_SORT], { pages: Array.from({ length: 10 }, (_, p) => page(`home-${p}`)), pageParams: [null] });
  for (let i = 0; i < visited; i++) {
    qc.setQueryData(["bookmarks", `folder-${i}`, DEFAULT_SORT], {
      pages: [page(`folder-${i}`)],
      pageParams: [null],
    });
  }
  qc.setQueryData(["bookmarks", "folder-0", DEFAULT_SORT], { pages: [page("protected")], pageParams: [null] });
  qc.setQueryData(["bookmarks", "library-index", 0], { pages: [page("catalogue")], pageParams: [null] });
  // Distinct dataUpdatedAt so recency is unambiguous.
  const cache = qc.getQueryCache();
  let at = 10_000;
  for (const query of cache.getAll()) query.setState({ dataUpdatedAt: --at });

  let stored = null;
  const persister = qp.createSnapshotPersister(
    { getString: () => stored, set: (_key, value) => { stored = value; }, remove: () => {} },
    "ordo.rq.test",
  );
  const protectedIds = qp.protectedFolderIdsFromFolders(qc.getQueryData(["folders"]));
  await persistQueryClientSave({
    queryClient: qc,
    persister,
    maxAge: Infinity,
    buster: qp.QUERY_CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) => query.state.status === "success" && qp.shouldPersistQueryKey(query.queryKey, protectedIds),
    },
  });

  const onDisk = JSON.parse(stored);
  const diskKeys = onDisk.clientState.queries.map((query) => JSON.stringify(query.queryKey));
  const diskLists = diskKeys.filter((key) => key.startsWith('["bookmarks"'));
  assert.ok(diskKeys.includes(JSON.stringify(["folders"])), "folders on disk");
  assert.ok(diskKeys.includes(JSON.stringify(["bookmarks", null, DEFAULT_SORT])), "cold-boot list on disk");
  assert.ok(!diskKeys.includes(JSON.stringify(["bookmarks", "folder-0", DEFAULT_SORT])), "protected list stays off disk");
  assert.ok(!diskKeys.some((key) => key.includes("library-index")), "global index stays off disk");
  assert.equal(
    diskLists.length,
    1 + qp.MAX_PERSISTED_RECENT_LISTS,
    `disk bounded regardless of ${visited} visited folders`,
  );

  // RAM untouched: every visited folder list still cached with its data.
  for (let i = 0; i < visited; i++) {
    assert.ok(qc.getQueryData(["bookmarks", `folder-${i}`, DEFAULT_SORT]), `folder-${i} still in RAM`);
  }
  assert.equal(qc.getQueryData(["bookmarks", "library-index", 0]).pages.length, 1, "catalogue still in RAM");
});
