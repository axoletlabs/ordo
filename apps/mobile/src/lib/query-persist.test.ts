import assert from "node:assert/strict";
import { test } from "node:test";
import { qk } from "./api/query-keys.ts";
import {
  MAX_PERSISTED_LIST_PAGES,
  QUERY_CACHE_STORAGE_PREFIX,
  isPersistedBookmarkListKey,
  queryCacheStorageKey,
  sanitizePersistedClient,
  shouldPersistQueryKey,
  trimPersistedQueryData,
  type PersistedClientSnapshot,
} from "./query-persist.ts";

test("queryCacheStorageKey is scoped by user and normalised server origin", () => {
  const key = queryCacheStorageKey("user-1", "HTTP://Library.example:3000/extra");
  assert.equal(key.startsWith(QUERY_CACHE_STORAGE_PREFIX), true);
  assert.equal(key, queryCacheStorageKey("user-1", "http://library.example:3000"));
  assert.notEqual(key, queryCacheStorageKey("user-2", "http://library.example:3000"));
  assert.notEqual(key, queryCacheStorageKey("user-1", "http://other.example:3000"));
});

test("only folders and public bookmark lists are persistable", () => {
  const protectedIds = new Set(["locked"]);
  assert.equal(shouldPersistQueryKey(qk.folders, protectedIds), true);
  assert.equal(shouldPersistQueryKey(qk.bookmarks(null, "newest"), protectedIds), true);
  assert.equal(shouldPersistQueryKey(qk.bookmarks("inbox", "title"), protectedIds), true);
  assert.equal(shouldPersistQueryKey(qk.bookmarks("locked", "newest"), protectedIds), false);

  assert.equal(shouldPersistQueryKey(qk.bookmark("b1"), protectedIds), false);
  assert.equal(shouldPersistQueryKey(qk.search("cats"), protectedIds), false);
  assert.equal(shouldPersistQueryKey(qk.tagged(["t1"]), protectedIds), false);
  assert.equal(shouldPersistQueryKey(qk.extractionProgress, protectedIds), false);
  assert.equal(shouldPersistQueryKey(qk.importJob("job"), protectedIds), false);
  assert.equal(shouldPersistQueryKey(qk.me, protectedIds), false);
  assert.equal(shouldPersistQueryKey(qk.tags(1), protectedIds), false);
  assert.equal(shouldPersistQueryKey(qk.folder("inbox"), protectedIds), false);
});

test("named folder lists stay off disk when the folder catalogue is missing", () => {
  assert.equal(shouldPersistQueryKey(qk.bookmarks(null, "newest"), undefined), true);
  assert.equal(shouldPersistQueryKey(qk.bookmarks("inbox", "newest"), undefined), false);
});

test("isPersistedBookmarkListKey rejects reserved bookmark prefixes", () => {
  assert.equal(isPersistedBookmarkListKey(qk.bookmarks(null, "oldest")), true);
  assert.equal(isPersistedBookmarkListKey(qk.bookmarks("abc", "titleDesc")), true);
  assert.equal(isPersistedBookmarkListKey(qk.bookmarks("abc")), false);
  assert.equal(isPersistedBookmarkListKey(qk.bookmark("abc")), false);
  assert.equal(isPersistedBookmarkListKey(["bookmarks", "detail", "newest"]), false);
});

test("trimPersistedQueryData keeps only the first list pages", () => {
  const pages = [1, 2, 3, 4, 5].map((n) => ({ items: [n] }));
  const data = { pages, pageParams: [null, "c1", "c2", "c3", "c4"] };
  const trimmed = trimPersistedQueryData(qk.bookmarks(null, "newest"), data) as typeof data;
  assert.notEqual(trimmed, data);
  assert.deepEqual(
    trimmed.pages.map((page) => page.items[0]),
    [1, 2, 3],
  );
  assert.equal(trimmed.pages.length, MAX_PERSISTED_LIST_PAGES);
  assert.deepEqual(trimmed.pageParams, [null, "c1", "c2"]);
  const html = { contentHtml: "<p>x</p>" };
  assert.equal(trimPersistedQueryData(qk.bookmark("b1"), html), html);
});

test("sanitizePersistedClient drops secrets, HTML, and extra pages", () => {
  const client: PersistedClientSnapshot = {
    timestamp: 1,
    buster: "ordo-query-v1",
    clientState: {
      mutations: [{ id: "m1" }],
      queries: [
        {
          queryKey: qk.folders,
          queryHash: "folders",
          state: {
            data: [
              { id: "inbox", protected: false },
              { id: "vault", protected: true },
            ],
          },
        },
        {
          queryKey: qk.bookmarks(null, "newest"),
          queryHash: "unfiled",
          state: {
            data: {
              pages: [{ items: [1] }, { items: [2] }, { items: [3] }, { items: [4] }],
              pageParams: [null, "a", "b", "c"],
            },
          },
        },
        {
          queryKey: qk.bookmarks("vault", "newest"),
          queryHash: "locked",
          state: { data: { pages: [{ items: ["secret"] }], pageParams: [null] } },
        },
        {
          queryKey: qk.bookmark("b1"),
          queryHash: "detail",
          state: { data: { id: "b1", contentHtml: "<p>article</p>" } },
        },
        {
          queryKey: qk.search("q"),
          queryHash: "search",
          state: { data: { pages: [{ items: ["hit"] }], pageParams: [null] } },
        },
      ],
    },
  };

  const next = sanitizePersistedClient(client);
  assert.deepEqual(next.clientState.mutations, []);
  assert.deepEqual(
    next.clientState.queries.map((query) => query.queryHash),
    ["folders", "unfiled"],
  );
  const unfiled = next.clientState.queries[1]?.state.data as {
    pages: unknown[];
    pageParams: unknown[];
  };
  assert.equal(unfiled.pages.length, MAX_PERSISTED_LIST_PAGES);
  assert.deepEqual(unfiled.pageParams, [null, "a", "b"]);
});
