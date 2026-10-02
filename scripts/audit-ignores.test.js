const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { parseIgnores, check } = require("../.github/scripts/check-audit-ignores.js");

const FIXTURE = `
auditConfig:
  ignoreGhsas:
    # A first reason line.
    # expires: 2026-11-01
    - GHSA-one1-aaaa-bbbb
    # expires: 2030-01-01
    - GHSA-two2-cccc-dddd
other:
  - not-an-ignore
`;

test("parses ignore ids with their leading comment blocks", () => {
  const ignores = parseIgnores(FIXTURE);
  assert.deepEqual(ignores.map((entry) => entry.id), ["GHSA-one1-aaaa-bbbb", "GHSA-two2-cccc-dddd"]);
  assert.match(ignores[0].comment, /expires: 2026-11-01/);
});

test("the shipped workspace ignore carries an expiry", () => {
  const yaml = readFileSync(resolve(__dirname, "../pnpm-workspace.yaml"), "utf8");
  for (const { id, comment } of parseIgnores(yaml)) {
    assert.match(comment, /expires: \d{4}-\d{2}-\d{2}/, `${id} needs an expiry`);
  }
});

function deps({ patched = null, published = true } = {}) {
  return {
    advisory: patched ? { vulnerabilities: [{ package: { name: "node-forge" }, first_patched_version: patched }] } : { vulnerabilities: [] },
    isPublished: () => published,
  };
}

test("a published patch or a passed expiry fails; a current ignore passes", () => {
  const ignores = parseIgnores(FIXTURE);
  assert.equal(check(ignores, "2026-10-02", deps()).length, 0);
  const expired = check(ignores, "2026-11-02", deps());
  assert.match(expired.join("\n"), /GHSA-one1-aaaa-bbbb.*expired on 2026-11-01/);
  const patched = check(ignores, "2026-10-02", deps({ patched: "1.4.1" }));
  assert.match(patched.join("\n"), /node-forge@1.4.1 is published/);
  assert.equal(check(ignores, "2026-10-02", deps({ patched: "1.4.1", published: false })).length, 0);
  const noExpiry = check([{ id: "GHSA-x", comment: "no date here" }], "2026-10-02", deps());
  assert.match(noExpiry.join("\n"), /needs an/);
});
