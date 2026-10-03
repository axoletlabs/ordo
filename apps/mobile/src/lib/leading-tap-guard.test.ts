import assert from "node:assert/strict";
import { test } from "node:test";
import { createLeadingTapGuard } from "./leading-tap-guard.ts";

test("first handoff is immediate and a double tap opens only once", () => {
  const accept = createLeadingTapGuard();
  assert.equal(accept("https://example.test", 0), true);
  assert.equal(accept("https://example.test", 50), false);
  assert.equal(accept("https://example.test", 499), false);
  assert.equal(accept("https://example.test", 500), true);
});
test("another URL never waits for the previous handoff", () => {
  const accept = createLeadingTapGuard();
  assert.equal(accept("first", 0), true);
  assert.equal(accept("second", 1), true);
});
