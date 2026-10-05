/** Deterministic workload, not a native frame-rate measurement. Run before/after on the same host. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createBookmarkSearchMatcher, prepareBookmarkSearch } from "@ordo/shared";
import { compileSearchResults, EMPTY_SEARCH_FILTERS } from "../src/lib/search-bookmarks.ts";

function measure(run, iterations = 40) {
  for (let i = 0; i < 5; i++) run();
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now(); run(); times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { medianMs: +times[Math.floor(times.length / 2)].toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2) };
}
const stamp = "2026-10-01T12:00:00Z";
const rows = Array.from({ length: 10000 }, (_, i) => ({
  id: `bookmark-${i}`, title: `${i % 10 ? "Reading" : "Material"} design notes ${i}`,
  url: `https://example.test/article/${i}`, domain: "example.test", description: "A practical guide to reading and interface design",
  author: null, folderId: null, isRead: false, remindAt: null, fetchStatus: "ok", contentKind: "article",
  tags: [{ id: "design", name: "Design", color: "teal" }], suggestedTags: [], createdAt: stamp, updatedAt: stamp,
}));
rows.forEach(prepareBookmarkSearch);
const workloads = ["mat", "material design", "reading", "missing", "materail"];
const results = {};
for (const query of workloads) {
  const run = () => compileSearchResults({ query, filters: { ...EMPTY_SEARCH_FILTERS, fuzzy: query === "materail" },
    cachedItems: rows, serverItems: [], serverMatchesQuery: false });
  const expected = run().map(item => item.id);
  results[query] = { rows: expected.length, ...measure(run) };
  assert.deepEqual(run().map(item => item.id), expected);
}
let bodyReads = 0;
const body = "Article body text with several words. ".repeat(2000);
const details = rows.slice(0, 1000).map(row => ({ ...row, get contentText() { bodyReads++; return body; } }));
const match = createBookmarkSearchMatcher("mat");
const start = performance.now();
details.forEach(item => match(item));
results.shortQueryWithReaderDetails = { records: details.length, bodyReads, elapsedMs: +(performance.now() - start).toFixed(2) };
assert.equal(bodyReads, 0, "Short queries must not index article bodies");
console.log(JSON.stringify({ host: `${process.platform}/${process.arch}`, catalogue: rows.length, results }, null, 2));
