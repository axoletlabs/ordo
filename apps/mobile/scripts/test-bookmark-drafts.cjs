const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const exports_ = {};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/bookmark-drafts.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { exports: exports_, require, URL });
const { normalizeBookmarkDraft, validateBookmarkDrafts } = exports_;
const validate = (...urls) => validateBookmarkDrafts(urls.map((url, id) => ({ id, url })));

assert.equal(normalizeBookmarkDraft("  example.com/article  "), "https://example.com/article");
assert.equal(normalizeBookmarkDraft("http://example.com"), "http://example.com");
assert.equal(normalizeBookmarkDraft("localhost:3000/article"), "https://localhost:3000/article");
assert.equal(normalizeBookmarkDraft(""), "");
assert.ok(validate("")[0].error, "an empty collection needs a link");
assert.ok(validate("", " ")[0].error);
assert.ok(validate("example.com", "").every((draft) => !draft.error), "ignore empty extra rows");
for (const url of ["https://", "http://?", "javascript:alert(1)", "ftp://example.com", "mailto:test@example.com", "not a web address", `https://example.com/${"a".repeat(2048)}`]) {
  assert.ok(validate(url)[0].error, `reject ${url.slice(0, 50)}`);
}
assert.ok(validate("https://EXAMPLE.com:443/", "example.com")[1].error, "normalize equivalent duplicates");
assert.ok(validate("example.com/a", "example.com/b").every((draft) => !draft.error), "distinct paths remain distinct");
assert.ok(validate("example.com?a=1", "example.com?a=2").every((draft) => !draft.error), "preserve query strings");
const input = [{ id: 9, url: "example.com", error: "old error" }];
assert.equal(validateBookmarkDrafts(input)[0].error, undefined, "corrected links clear stale errors");
assert.equal(input[0].error, "old error", "validation does not mutate the draft");
console.log("Bookmark draft validation passed.");
