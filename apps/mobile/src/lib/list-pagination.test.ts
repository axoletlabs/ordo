import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PAGE_SIZE } from "@ordo/shared";
import {
  LIST_END_REACHED_THRESHOLD,
  LIST_PAGE_SIZE,
  pageLoadMadeProgress,
  shouldFetchNextPage,
} from "./list-pagination.ts";

test("list pages use the server maximum so a typical folder is one request", () => {
  assert.equal(LIST_PAGE_SIZE, MAX_PAGE_SIZE);
  assert.ok(LIST_END_REACHED_THRESHOLD < 0.4);
});

test("shouldFetchNextPage refuses a fetch while busy, locked, or stalled", () => {
  const idle = {
    hasNextPage: true,
    isFetchingNextPage: false,
    locked: false,
    stalled: false,
  };
  assert.equal(shouldFetchNextPage(idle), true);
  assert.equal(shouldFetchNextPage({ ...idle, hasNextPage: false }), false);
  assert.equal(shouldFetchNextPage({ ...idle, isFetchingNextPage: true }), false);
  assert.equal(shouldFetchNextPage({ ...idle, locked: true }), false);
  assert.equal(shouldFetchNextPage({ ...idle, stalled: true }), false);
});

test("pageLoadMadeProgress is false when a next page added no unique rows", () => {
  assert.equal(pageLoadMadeProgress(20, 35), true);
  assert.equal(pageLoadMadeProgress(20, 20), false);
  assert.equal(pageLoadMadeProgress(20, 19), false);
});
