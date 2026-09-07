import assert from "node:assert/strict";
import { test } from "node:test";
import { selectNativeUpdate, type VersionedRelease } from "./app-version.ts";

function rel(
  version: string,
  opts: { prerelease?: boolean; publishedAt?: string } = {},
): VersionedRelease {
  return {
    version,
    prerelease: opts.prerelease ?? version.includes("-"),
    publishedAt: opts.publishedAt ?? "2026-01-01T00:00:00Z",
  };
}

test("stable-only mode offers the newest stable and ignores GitHub pre-releases", () => {
  const picked = selectNativeUpdate(
    [
      rel("0.2.0-beta.3", { prerelease: true, publishedAt: "2026-09-01T00:00:00Z" }),
      rel("0.2.0", { prerelease: false, publishedAt: "2026-08-01T00:00:00Z" }),
      rel("0.1.5", { prerelease: false, publishedAt: "2026-07-01T00:00:00Z" }),
    ],
    "0.1.0",
    false,
  );
  assert.equal(picked?.version, "0.2.0");
});

test("early access does not offer 0.2.0-beta.3 over 0.2.0 stable", () => {
  const picked = selectNativeUpdate(
    [
      rel("0.2.0-beta.3", { prerelease: true, publishedAt: "2026-09-07T00:00:00Z" }),
      rel("0.2.0", { prerelease: false, publishedAt: "2026-09-01T00:00:00Z" }),
    ],
    "0.1.0",
    true,
  );
  assert.equal(picked?.version, "0.2.0");
});

test("early access offers a pre-release of the next version", () => {
  const picked = selectNativeUpdate(
    [
      rel("0.2.0"),
      rel("0.3.0-alpha.1", { prerelease: true }),
      rel("0.3.0-beta.2", { prerelease: true }),
    ],
    "0.2.0",
    true,
  );
  assert.equal(picked?.version, "0.3.0-beta.2");
});

test("early access ranks RC above beta of the same core version", () => {
  const picked = selectNativeUpdate(
    [rel("0.3.0-beta.5", { prerelease: true }), rel("0.3.0-rc.1", { prerelease: true })],
    "0.2.0",
    true,
  );
  assert.equal(picked?.version, "0.3.0-rc.1");
});

test("turning early access off never downgrades from a newer pre-release to an older stable", () => {
  const picked = selectNativeUpdate([rel("0.2.0")], "0.3.0-alpha.1", false);
  assert.equal(picked, null);
});

test("a user on a beta can still take the matching stable with early access off", () => {
  const picked = selectNativeUpdate([rel("0.2.0")], "0.2.0-rc.1", false);
  assert.equal(picked?.version, "0.2.0");
});

test("ignores non-semver tags such as dev", () => {
  const picked = selectNativeUpdate(
    [rel("dev", { prerelease: true }), rel("0.2.0")],
    "0.1.0",
    true,
  );
  assert.equal(picked?.version, "0.2.0");
});
