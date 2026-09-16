import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSharedUrl } from "./shared-url.ts";

test("prefers an explicit web URL over surrounding share text", () => {
  assert.equal(
    extractSharedUrl("https://example.com/a", "See https://other.example/b"),
    "https://example.com/a",
  );
});

test("pulls the first http(s) URL out of shared text", () => {
  assert.equal(
    extractSharedUrl(null, "Read this: https://example.com/path?q=1"),
    "https://example.com/path?q=1",
  );
});

test("strips trailing punctuation and unmatched wrappers", () => {
  assert.equal(extractSharedUrl(null, "(https://example.com/a)."), "https://example.com/a");
  assert.equal(extractSharedUrl(null, "[https://example.com/a]"), "https://example.com/a");
});

test("rejects non-http(s) candidates", () => {
  assert.equal(extractSharedUrl("ftp://example.com/a", null), null);
  assert.equal(extractSharedUrl(null, "no link here"), null);
});

test("falls back to share text when the parsed web URL is not http(s)", () => {
  assert.equal(
    extractSharedUrl("ftp://example.com/a", "See https://example.com/b"),
    "https://example.com/b",
  );
});
