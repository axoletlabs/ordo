import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRefreshExtractionQuery } from "./extraction-sync.ts";

const listKey = ["bookmarks", null, "newest"];
const pendingRow = { id: "saved", fetchStatus: "pending" };
const pendingPages = { pages: [{ items: [] }, { items: [pendingRow] }] };

test("refreshes a cached pending row when extraction completes before the first poll", () => {
  assert.equal(shouldRefreshExtractionQuery(listKey, pendingPages, null, 0), true);
});

test("refreshes pending rows when polling restarts from an idle zero count", () => {
  assert.equal(shouldRefreshExtractionQuery(listKey, pendingPages, 0, 0), true);
  assert.equal(shouldRefreshExtractionQuery(listKey, pendingPages, 0, 1), true);
});

test("refreshes pending rows when a new save masks a completion with the same count", () => {
  assert.equal(shouldRefreshExtractionQuery(listKey, pendingPages, 2, 2), true);
});

test("reconciles folder, tag, search and reader queries with pending data", () => {
  for (const key of [["bookmarks", "folder"], ["bookmarks", "tagged", ["tag"]],
    ["bookmarks", "search", "article"]]) {
    assert.equal(shouldRefreshExtractionQuery(key, pendingPages, 1, 1), true);
  }
  assert.equal(shouldRefreshExtractionQuery(["bookmarks", "detail", "saved"], pendingRow, 1, 1), true);
});

test("skips the progressively-loaded library index until the count drops", () => {
  const indexKey = ["bookmarks", "library-index", 0];
  assert.equal(shouldRefreshExtractionQuery(indexKey, pendingPages, 1, 1), false);
  assert.equal(shouldRefreshExtractionQuery(indexKey, pendingPages, 2, 1), true);
});

test("a decreasing count still refreshes completed views for newly extracted search matches", () => {
  assert.equal(shouldRefreshExtractionQuery(listKey, { pages: [{ items: [] }] }, 2, 1), true);
});

test("does not refresh settled lists just because other bookmarks are extracting", () => {
  for (const fetchStatus of ["ok", "unsupported", "failed"]) {
    assert.equal(shouldRefreshExtractionQuery(listKey, { pages: [{ items: [{ fetchStatus }] }] }, 1, 1), false);
  }
});

test("never invalidates progress itself or unrelated queries", () => {
  assert.equal(shouldRefreshExtractionQuery(["bookmarks", "extraction-progress"], { pending: 0 }, 1, 0), false);
  assert.equal(shouldRefreshExtractionQuery(["folders"], pendingPages, 1, 0), false);
});

test("ignores empty and non-bookmark payloads at an unchanged count", () => {
  for (const data of [undefined, null, {}, [], { pending: 1 }, { pages: [null, {}] }]) {
    assert.equal(shouldRefreshExtractionQuery(listKey, data, 1, 1), false);
  }
});
