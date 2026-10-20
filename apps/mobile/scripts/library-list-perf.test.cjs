/** Run: node --test apps/mobile/scripts/library-list-perf.test.cjs
 * Guards for the library list interaction-performance work: cache-write
 * coalescing behind cached search matches, search merge correctness, result
 * array reuse, and bounded propagation even during continuous cache writes.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("../../../node_modules/typescript");
const React = require("../../../node_modules/react");

function load(path, stubs = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  const requireModule = (name) => {
    if (stubs[name]) return stubs[name];
    if (name === "react") return React;
    return require(name.startsWith("@ordo") ? resolve(__dirname, "../node_modules", name) : name);
  };
  new Function("require", "module", "exports", outputText)(requireModule, module, module.exports);
  return module.exports;
}

const sb = load("lib/search-bookmarks.ts");

function bookmark(overrides = {}) {
  return {
    id: "b1",
    title: "Reading list ideas",
    url: "https://example.com/reading",
    domain: "example.com",
    description: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isRead: false,
    fetchStatus: "ok",
    contentKind: "article",
    remindAt: null,
    readingTimeMinutes: 3,
    suggestedTags: [],
    folderId: null,
    ...overrides,
  };
}

test("coalescer collapses a burst of cache writes into one bounded flush", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let flushes = 0;
  const coalescer = sb.createCacheWriteCoalescer(() => flushes++, 25);
  coalescer.bump();
  coalescer.bump();
  t.mock.timers.tick(10);
  coalescer.bump();
  t.mock.timers.tick(14);
  assert.equal(flushes, 0);
  t.mock.timers.tick(1);
  assert.equal(flushes, 1, "burst produced exactly one flush");
  coalescer.cancel();
});

test("coalescer opens a new window after a flush", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flushes = [];
  const coalescer = sb.createCacheWriteCoalescer(() => flushes.push(Date.now()), 20);
  coalescer.bump();
  t.mock.timers.tick(20);
  assert.equal(flushes.length, 1);
  coalescer.bump();
  t.mock.timers.tick(20);
  assert.equal(flushes.length, 2, "a write after a flush still flushes");
});

test("coalescer cancel drops a pending flush", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let flushes = 0;
  const coalescer = sb.createCacheWriteCoalescer(() => flushes++, 20);
  coalescer.bump();
  coalescer.cancel();
  t.mock.timers.tick(40);
  assert.equal(flushes, 0);
  // Still usable after cancel.
  coalescer.bump();
  t.mock.timers.tick(40);
  assert.equal(flushes, 1);
});

test("continuous writes cannot starve cached matches", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let flushes = 0;
  const coalescer = sb.createCacheWriteCoalescer(() => flushes++, 150);
  for (let index = 0; index < 60; index++) {
    coalescer.bump();
    t.mock.timers.tick(10);
  }
  assert.equal(flushes, 4, "flush at least once per 150 ms even without a quiet interval");
  coalescer.cancel();
});

test("compileSearchResults prefers the freshest copy and dedupes by id", () => {
  const cachedNew = bookmark({ id: "b1", title: "Fresh cached copy", updatedAt: "2026-02-02T00:00:00.000Z" });
  const cachedOld = bookmark({ id: "b2", title: "Stale cached copy", updatedAt: "2026-01-01T00:00:00.000Z" });
  const serverNew = bookmark({ id: "b2", title: "Fresh server copy", updatedAt: "2026-03-03T00:00:00.000Z" });
  const results = sb.compileSearchResults({
    query: "",
    filters: sb.EMPTY_SEARCH_FILTERS,
    serverItems: [serverNew],
    cachedItems: [cachedNew, cachedOld],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    results.map((row) => row.id).sort(),
    ["b1", "b2"],
    "ids dedupe across server and cached",
  );
  const byId = new Map(results.map((row) => [row.id, row]));
  assert.equal(byId.get("b1").title, "Fresh cached copy");
  assert.equal(byId.get("b2").title, "Fresh server copy");
});

test("compileSearchResults keeps cached-only prefix matches without server rows", () => {
  const row = bookmark({ id: "b1", title: "Reading list ideas" });
  const results = sb.compileSearchResults({
    query: "read",
    filters: sb.EMPTY_SEARCH_FILTERS,
    serverItems: [],
    cachedItems: [row, bookmark({ id: "b2", title: "Unrelated", url: "https://x.com", domain: "x.com" })],
    serverMatchesQuery: false,
  });
  assert.deepEqual(results.map((item) => item.id), ["b1"]);
});

test("compileSearchResults respects scope filters over cached matches", () => {
  const results = sb.compileSearchResults({
    query: "read",
    filters: { ...sb.EMPTY_SEARCH_FILTERS, status: "unread" },
    serverItems: [],
    cachedItems: [bookmark({ id: "read-match", title: "Reading list", isRead: true })],
    serverMatchesQuery: false,
  });
  assert.deepEqual(results, [], "read rows are filtered out of an unread-only search");
});

test("reuseSearchResults keeps the previous array when only row identity churned", () => {
  const previous = [bookmark({ id: "b1" }), bookmark({ id: "b2" })];
  // A cache rewrite produced equal-but-new row objects; the list must not see
  // a new data array (identity churn alone is not a visible change).
  const next = previous.map((row) => ({ ...row, tags: row.tags.map((tag) => ({ ...tag })) }));
  const reused = sb.reuseSearchResults(previous, next);
  assert.equal(reused, previous, "equal content keeps the previous identity");
  const identical = sb.reuseSearchResults(previous, previous);
  assert.equal(identical, previous, "identical input keeps the previous identity");
});

test("reuseSearchResults returns the next array when a visible field changed", () => {
  const previous = [bookmark({ id: "b1", isRead: false })];
  const next = [bookmark({ id: "b1", isRead: true })];
  assert.equal(sb.reuseSearchResults(previous, next), next);
});
