"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Resolve the decoder the same way as query-string, including non-hoisted installs.
const queryStringPath = require.resolve("query-string", { paths: [path.join(__dirname, "../apps/mobile")] });
const decoderPath = require.resolve("decode-uri-component", { paths: [path.dirname(queryStringPath)] });
const queryString = require(queryStringPath);
const decode = require(decoderPath);

assert.equal(decode("a+b"), "a b");
assert.equal(decode("%C3%A9"), "é");
assert.equal(decode("%zz%41"), "%zzA");
assert.equal(decode("%FE%FF"), "\uFFFD\uFFFD");
assert.throws(() => decode(null), TypeError);
const parsed = queryString.parseUrl("https://example.test/?name=A+B&word=%E2%9C%93#one+two", {
  parseFragmentIdentifier: true,
});
assert.equal(parsed.query.name, "A B");
assert.equal(parsed.query.word, "✓");
assert.equal(parsed.fragmentIdentifier, "one two");

// GHSA-qr28-fpjm-wq7f: many distinct encoded runs plus a malformed ending.
// A separate process lets the test stop a decoder that blocks the event loop.
const child = spawnSync(process.execPath, ["-e", `
  const decode = require(process.argv[1]);
  let payload = "";
  for (let i = 0; i < 32000; i++) {
    payload += "%" + (i >> 8).toString(16).padStart(2, "0")
      + "%" + (i & 255).toString(16).padStart(2, "0") + "x";
  }
  const result = decode(payload + "%zz");
  if (!result.endsWith("%zz")) process.exit(1);
`, decoderPath], { encoding: "utf8", timeout: 10000 });
assert.ifError(child.error);
assert.equal(child.status, 0, child.stderr);
console.log("URI decoder compatibility and malformed input checks passed.");
