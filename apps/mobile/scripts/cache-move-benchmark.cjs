/** Compare actual cache moves with a repository revision, on identical fixtures.
 * node --expose-gc apps/mobile/scripts/cache-move-benchmark.cjs 01af889
 * Timings are diagnostic, not CI thresholds or native frame-time measurements.
 */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const nativeRequire = createRequire(resolve(__dirname, "../package.json"));
const { QueryClient } = nativeRequire("@tanstack/react-query");
const root = resolve(__dirname, "../../..");
const revision = process.argv[2] ?? "01af889";
function sourceLoader(baseline) {
  const cache = new Map();
  function load(filename) {
    filename = resolve(__dirname, "../src", filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = baseline && filename.endsWith("/lib/cache-helpers.ts")
      ? execFileSync("git", ["show", `${revision}:apps/mobile/src/lib/cache-helpers.ts`], { cwd: root, encoding: "utf8" })
      : readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const requireLocal = (name) => name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`)) : nativeRequire(name);
    new Function("require", "module", "exports", outputText)(requireLocal, module, module.exports);
    return module.exports;
  }
  return { helpers: load("lib/cache-helpers.ts"), keys: load("lib/api/query-keys.ts") };
}
function run({ helpers, keys }) {
  const { qk, flattenPages } = keys;
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const items = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), folderId: "source", title: `Reading ${id}`,
    url: "https://example.test", domain: "example.test", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    tags: [], suggestedTags: [], isRead: false, remindAt: null, fetchStatus: "ok", contentKind: "article" }));
  const paged = (items) => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] });
  const source = qk.bookmarks("source", "newest"), destination = qk.bookmarks("destination", "title");
  qc.setQueryData(source, paged(items)); qc.setQueryData(destination, paged([]));
  qc.setQueryData(qk.libraryIndex(0), paged(items));
  qc.setQueryData(qk.search("Reading", [], "all", ["source"]), paged(items));
  qc.setQueryData(qk.folders, [{ id: "source", bookmarkCount: 1000, unreadCount: 1000 }, { id: "destination", bookmarkCount: 0, unreadCount: 0 }]);
  const originals = items.slice(0, 500);
  let notifications = 0;
  const unsubscribe = qc.getQueryCache().subscribe((event) => { if (event.type === "updated") notifications++; });
  global.gc?.();
  const start = performance.now();
  if (helpers.moveBookmarksInCache) {
    helpers.moveBookmarksInCache(qc, originals.map((row) => ({ ...row, folderId: "destination" })));
    helpers.moveFolderCounts(qc, originals, "destination");
  } else for (const row of originals) {
    helpers.moveBookmarkInCache(qc, { ...row, folderId: "destination" });
    helpers.bumpFolderCount(qc, "source", -1, -1);
    helpers.bumpFolderCount(qc, "destination", 1, 1);
  }
  const elapsedMs = performance.now() - start;
  assert.equal(flattenPages(qc.getQueryData(source).pages).length, 500);
  assert.equal(flattenPages(qc.getQueryData(destination).pages).length, 500);
  assert.deepEqual(qc.getQueryData(qk.folders).map((folder) => folder.bookmarkCount), [500, 500]);
  unsubscribe(); qc.clear();
  return { elapsedMs: +elapsedMs.toFixed(2), notifications };
}
const results = {};
for (const [label, baseline] of [[revision, true], ["workingTree", false]]) {
  const loaded = sourceLoader(baseline);
  run(loaded); // Warm the transpiled code and comparison functions, not measured.
  const samples = Array.from({ length: 5 }, () => run(loaded));
  results[label] = { samples, medianMs: samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b)[2] };
}
console.log(JSON.stringify({ fixture: "Move 500 of 1000 bookmarks across five caches", ...results }, null, 2));
