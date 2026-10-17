/** Real cache operations without booting React Native. Run via `pnpm test`. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const { createRequire } = require("node:module");
const ts = require("typescript");
const nativeRequire = createRequire(resolve(__dirname, "../package.json"));
const modules = new Map();
function load(relative) {
  const filename = resolve(__dirname, "../src", relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = { exports: {} };
  modules.set(filename, mod);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const localRequire = (name) => name.startsWith(".")
    ? load(resolve(dirname(filename), `${name}.ts`)) : nativeRequire(name);
  new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
  return mod.exports;
}
const { QueryClient } = nativeRequire("@tanstack/react-query");
const { qk, flattenPages } = load("lib/api/query-keys.ts");
const { moveBookmarksInCache, moveFolderCounts, rollbackBookmarkMoves } = load("lib/cache-helpers.ts");
const { estimateBookmarkRowSize } = load("lib/bookmark-row-layout.ts");
const { shouldRefreshExtractionQuery } = load("lib/extraction-sync.ts");
const { reconcileReadingProgress, shouldFlushReadingProgress } = load("lib/reading-progress.ts");
const { createLatestWriteQueue } = load("lib/latest-write-queue.ts");
const { resolvePalette } = load("theme/theme.ts");
const stamp = "2026-10-01T00:00:00.000Z";
function bookmark(id, folderId = "source") {
  return { id: String(id), folderId, title: `Item ${String(id).padStart(5, "0")}`, url: "https://example.test",
    domain: "example.test", createdAt: stamp, updatedAt: stamp, isRead: false, tags: [], suggestedTags: [], remindAt: null,
    fetchStatus: "ok", contentKind: "article", ...(String(id) === "0" ? { remindAt: 123 } : {}) };
}
function paged(items) {
  return { pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] };
}
function fixture(count = 1000) {
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const items = Array.from({ length: count }, (_, i) => bookmark(i));
  const source = qk.bookmarks("source", "newest"), destination = qk.bookmarks("destination", "title");
  qc.setQueryData(source, paged(items));
  qc.setQueryData(destination, paged([bookmark("existing", "destination")]));
  qc.setQueryData(qk.libraryIndex(0), paged(items));
  qc.setQueryData(qk.search("Item", [], "all", ["source"]), paged(items));
  qc.setQueryData(qk.bookmark("0"), { ...items[0], contentHtml: "<p>Retained article</p>", highlights: [] });
  qc.setQueryData(qk.folders, [{ id: "source", bookmarkCount: count, unreadCount: count },
    { id: "destination", bookmarkCount: 1, unreadCount: 1 }]);
  qc.setQueryData(qk.reminders, [{ id: "0", folderId: "source", remindAt: 123 }]);
  return { qc, items, source, destination };
}
const rows = (qc, key) => flattenPages(qc.getQueryData(key).pages);

test("500-bookmark moves publish bounded cache updates and keep all memberships correct", () => {
  const { qc, items, source, destination } = fixture();
  let updates = 0;
  const unsubscribe = qc.getQueryCache().subscribe((event) => { if (event.type === "updated") updates++; });
  const originals = items.slice(0, 500);
  const start = performance.now();
  moveBookmarksInCache(qc, originals.map((item) => ({ ...item, folderId: "destination" })));
  moveFolderCounts(qc, originals, "destination");
  const elapsed = performance.now() - start;
  assert.equal(rows(qc, source).length, 500);
  assert.equal(rows(qc, destination).length, 501);
  assert.equal(rows(qc, qk.search("Item", [], "all", ["source"])).length, 500);
  assert.equal(rows(qc, qk.libraryIndex(0)).length, 1000);
  assert.ok(rows(qc, qk.libraryIndex(0)).slice(0, 500).every((row) => row.folderId === "destination"));
  assert.equal(qc.getQueryData(qk.bookmark("0")).contentHtml, "<p>Retained article</p>");
  assert.equal(qc.getQueryData(qk.reminders)[0].folderId, "destination");
  assert.deepEqual(qc.getQueryData(qk.folders).map((row) => row.bookmarkCount), [500, 501]);
  assert.ok(updates <= 14, `Expected O(caches) notifications, got ${updates}`);
  console.log(JSON.stringify({ operation: "move-500-of-1000", elapsedMs: +elapsed.toFixed(2), cacheUpdates: updates }));
  unsubscribe(); qc.clear();
});

test("failed batch rollback preserves another concurrent move", () => {
  const { qc, items, source, destination } = fixture(10);
  const snapshot = qc.getQueriesData({ queryKey: ["bookmarks"] });
  const move = (originals) => {
    moveBookmarksInCache(qc, originals.map((row) => ({ ...row, folderId: "destination" })));
    moveFolderCounts(qc, originals, "destination");
  };
  move(items.slice(0, 3)); move([items[8]]);
  rollbackBookmarkMoves(qc, items.slice(0, 3), "destination", snapshot);
  assert.deepEqual(rows(qc, destination).map((row) => row.id).sort(), ["8", "existing"]);
  assert.equal(rows(qc, source).length, 9);
  assert.deepEqual(qc.getQueryData(qk.folders).map((row) => row.bookmarkCount), [9, 2]);
  assert.equal(qc.getQueryData(qk.reminders)[0].folderId, "source");
  qc.clear();
});

test("batch moves support mixed origins, root destination, duplicates and repeat reconciliation", () => {
  const { qc, items, destination } = fixture(3);
  const moved = [items[0], items[1]].map((row) => ({ ...row, folderId: "destination" }));
  moveBookmarksInCache(qc, moved); moveBookmarksInCache(qc, moved);
  assert.equal(rows(qc, destination).length, 3);
  qc.setQueryData(qk.bookmarks(null, "newest"), paged([]));
  moveBookmarksInCache(qc, [...moved, bookmark("existing", "destination")].map((row) => ({ ...row, folderId: null })));
  assert.equal(rows(qc, destination).length, 0);
  assert.equal(rows(qc, qk.bookmarks(null, "newest")).length, 3);
  qc.clear();
});

test("exact row offsets reserve full tag targets without inflating plain metadata rows", () => {
  const plain = bookmark(1);
  assert.equal(estimateBookmarkRowSize(plain), 72);
  assert.equal(estimateBookmarkRowSize({ ...plain, remindAt: 123 }), 96);
  const tagged = { ...plain, tags: [{ id: "tag", name: "Design" }] };
  assert.equal(estimateBookmarkRowSize(tagged), 120);
  assert.equal(estimateBookmarkRowSize(tagged, ["tag"]), 72);
});

test("extraction completion never refetches a whole paginated library catalogue", () => {
  for (const [previous, pending] of [[null, 0], [10, 9], [10, 10], [1, 0]]) {
    assert.equal(shouldRefreshExtractionQuery(qk.libraryIndex(0), paged([{ fetchStatus: "pending" }]), previous, pending), false);
  }
  assert.equal(shouldRefreshExtractionQuery(qk.bookmarks(null, "newest"), paged([{ fetchStatus: "pending" }]), 10, 10), true);
  assert.equal(shouldRefreshExtractionQuery(qk.bookmarks(null, "newest"), paged([{ fetchStatus: "ok" }]), 10, 9), true);
});

test("reading completion triggers once instead of a request on every bottom-of-page scroll", () => {
  assert.equal(shouldFlushReadingProgress(0.96, 0.94, 0.08, 0.95), true);
  assert.equal(shouldFlushReadingProgress(0.97, 0.96, 0.08, 0.95), false);
  assert.equal(shouldFlushReadingProgress(0.8, 0.96, 0.08, 0.95), true);
});

test("progress responses cannot undo a concurrent folder/tag edit or discard detail", () => {
  const stale = { ...bookmark(1), readProgress: 0.8, isRead: false, completedAt: null };
  const current = { ...bookmark(1, "destination"), tags: [{ id: "new-tag" }], contentHtml: "<p>Keep me</p>", updatedAt: "2026-10-02T00:00:00Z" };
  const next = reconcileReadingProgress(current, stale);
  assert.equal(next.folderId, "destination");
  assert.deepEqual(next.tags, current.tags);
  assert.equal(next.contentHtml, current.contentHtml);
  assert.equal(next.updatedAt, current.updatedAt);
  assert.equal(next.readProgress, 0.8);
});

test("latest-write queue serializes, coalesces and cannot reconcile an older response", async () => {
  const requests = [], commits = [], resolvers = [];
  const enqueue = createLatestWriteQueue((value) => {
    requests.push(value);
    return new Promise((resolve) => resolvers.push(resolve));
  }, (result) => commits.push(result));
  enqueue("article", 0.1); enqueue("article", 0.2); enqueue("article", 0.3);
  assert.deepEqual(requests, [0.1]);
  resolvers.shift()(0.1); await new Promise(setImmediate);
  assert.deepEqual(requests, [0.1, 0.3]); assert.deepEqual(commits, []);
  resolvers.shift()(0.3); await new Promise(setImmediate);
  assert.deepEqual(commits, [0.3]);
  enqueue("article", 0.4); assert.deepEqual(requests, [0.1, 0.3, 0.4]);
  resolvers.shift()(0.4); await new Promise(setImmediate);
});

test("a failed progress write does not wedge later writes or a different article", async () => {
  const commits = [], requests = [];
  let rejectFirst;
  const enqueue = createLatestWriteQueue((value) => {
    requests.push(value);
    return value === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : Promise.resolve(value);
  }, (result) => commits.push(result));
  enqueue("first", 1); enqueue("first", 2); enqueue("other", 3);
  rejectFirst(new Error("offline")); await new Promise(setImmediate);
  assert.deepEqual(requests, [1, 3, 2]); assert.deepEqual(commits, [3, 2]);
});

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
test("Material tonal pairs retain text contrast in both modes, AMOLED and contrast levels", () => {
  for (const mode of ["light", "dark"]) for (const expressive of [false, true]) for (const amoled of [false, true]) for (const level of [0, 0.5, 1]) {
    const p = resolvePalette(mode, amoled, mode, undefined, expressive, level);
    for (const [surface, ink] of [["primary", "onPrimary"], ["primaryContainer", "onPrimaryContainer"],
      ["secondary", "onSecondary"], ["secondaryContainer", "onSecondaryContainer"],
      ["tertiary", "onTertiary"], ["tertiaryContainer", "onTertiaryContainer"],
      ["error", "onError"], ["errorContainer", "onErrorContainer"], ["surface", "onSurface"],
      ["surfaceContainerHigh", "onSurfaceVariant"], ["surfaceContainerLow", "onSurface"],
      ["inverseSurface", "inverseOnSurface"], ["inverseSurface", "inversePrimary"], ["background", "onSurface"]]) {
      assert.ok(contrast(p[surface], p[ink]) >= 4.5, `${mode}/${expressive}/${amoled}/${level}: ${ink} on ${surface}`);
    }
  }
});
