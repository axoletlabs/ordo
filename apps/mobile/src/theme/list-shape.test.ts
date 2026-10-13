import assert from "node:assert/strict";
import { test } from "node:test";
import { listCorners, listPosition } from "./list-shape.ts";

test("segmented list distinguishes group edges from inner joins", () => {
  assert.deepEqual([0, 1, 2].map((index) => listPosition(index, 3)), ["first", "middle", "last"]);
  assert.equal(listPosition(0, 1), "only");
  assert.deepEqual(listCorners("first", false), { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 });
  assert.equal(listCorners("middle", false).borderTopLeftRadius, 4);
  assert.equal(listCorners("last", false).borderBottomLeftRadius, 16);
});
test("selected rows use 16dp corners regardless of list position", () => {
  for (const position of ["first", "middle", "last", "only"] as const) assert.deepEqual(Object.values(listCorners(position, true)), [16, 16, 16, 16]);
});
