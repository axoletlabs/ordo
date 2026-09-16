import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKMARK_DETAIL_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from "./fetch-timeout.ts";

test("article HTML is allowed more time than a normal API call", () => {
  assert.ok(BOOKMARK_DETAIL_TIMEOUT_MS > REQUEST_TIMEOUT_MS);
  assert.ok(BOOKMARK_DETAIL_TIMEOUT_MS >= 30_000);
});
