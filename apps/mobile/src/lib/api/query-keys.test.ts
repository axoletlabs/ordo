import assert from "node:assert/strict";
import { test } from "node:test";
import type { CursorPage } from "@ordo/shared";
import { flattenPages, nextPageCursor } from "./query-keys.ts";

function page<T>(items: T[], nextCursor: string | null = null, hasMore = false): CursorPage<T> {
  return { items, nextCursor, hasMore };
}

test("flattenPages concatenates unique rows", () => {
  assert.deepEqual(
    flattenPages([page([{ id: "a" }, { id: "b" }]), page([{ id: "c" }])]).map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("flattenPages drops a retried page so sorting cannot pair A,A,B,B", () => {
  const first = page(
    [
      { id: "a", createdAt: "2026-02-01" },
      { id: "b", createdAt: "2026-01-01" },
    ],
    "cursor-b",
    true,
  );
  const retried = page(
    [
      { id: "a", createdAt: "2026-02-01" },
      { id: "b", createdAt: "2026-01-01" },
    ],
    "cursor-b",
    true,
  );
  assert.deepEqual(
    flattenPages([first, retried]).map((item) => item.id),
    ["a", "b"],
  );
});

test("nextPageCursor ignores hasMore when the cursor is missing", () => {
  assert.equal(nextPageCursor({ hasMore: true, nextCursor: "c2" }), "c2");
  assert.equal(nextPageCursor({ hasMore: true, nextCursor: null }), undefined);
  assert.equal(nextPageCursor({ hasMore: false, nextCursor: "c2" }), undefined);
});
