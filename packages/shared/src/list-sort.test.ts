import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_BOOKMARK_LIST_SORT,
  isBookmarkListSort,
  parseBookmarkListSort,
} from "./list-sort.ts";

test("parseBookmarkListSort keeps known values", () => {
  assert.equal(parseBookmarkListSort("oldest"), "oldest");
  assert.equal(parseBookmarkListSort("title"), "title");
  assert.equal(parseBookmarkListSort("titleDesc"), "titleDesc");
  assert.equal(parseBookmarkListSort("newest"), "newest");
});

test("parseBookmarkListSort falls back to newest", () => {
  assert.equal(parseBookmarkListSort(undefined), DEFAULT_BOOKMARK_LIST_SORT);
  assert.equal(parseBookmarkListSort("nope"), DEFAULT_BOOKMARK_LIST_SORT);
  assert.equal(isBookmarkListSort("title"), true);
  assert.equal(isBookmarkListSort("name"), false);
});
