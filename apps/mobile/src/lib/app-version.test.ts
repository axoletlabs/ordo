import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_VARIANTS, appVariantForPackage, classifyReleaseVersion, compareVersions,
  easUpdatesChannel, isNewerVersion, releaseLineBranch, resolveUpdatesChannel,
  validateReleaseBranch, validateReleaseTag,
} from "./app-version.ts";

test("Preview uses semver ordering with numeric sequence numbers", () => {
  assert.equal(compareVersions("0.2.0", "0.2.0-preview.3"), 1);
  assert.equal(isNewerVersion("0.2.0-preview.3", "0.2.0"), false);
  assert.equal(isNewerVersion("0.2.0-preview.10", "0.2.0-preview.3"), true);
  assert.equal(isNewerVersion("0.3.0-preview.1", "0.2.0"), true);
});

test("classifyReleaseVersion accepts only Stable and Preview tags", () => {
  assert.deepEqual(classifyReleaseVersion("v0.2.0"), { version: "0.2.0", kind: "stable", channel: null, number: null });
  assert.deepEqual(classifyReleaseVersion("0.2.0-preview.3"), { version: "0.2.0-preview.3", kind: "prerelease", channel: "preview", number: 3 });
  assert.equal(classifyReleaseVersion("0.2.0-preview")?.number, null);
  for (const value of ["dev", "0.2.0-alpha.1", "0.2.0-beta.1", "0.2.0-rc.1", "0.01.0", "0.1.0-preview.01", "0.1.0garbage", "0.1.0-", "9007199254740992.0.0"]) {
    assert.equal(classifyReleaseVersion(value), null, value);
    assert.equal(releaseLineBranch(value), null, value);
  }
});

test("exactly three independent native identities exist", () => {
  assert.deepEqual(Object.keys(APP_VARIANTS), ["stable", "preview", "development"]);
  assert.equal(new Set(Object.values(APP_VARIANTS).map((identity) => identity.package)).size, 3);
  assert.equal(APP_VARIANTS.stable.package, "com.axolet.ordo");
  assert.equal(APP_VARIANTS.preview.name, "ordo (preview)");
  assert.equal(APP_VARIANTS.development.channel, null);
  for (const variant of ["stable", "preview", "development"] as const) {
    assert.equal(appVariantForPackage(APP_VARIANTS[variant].package), variant);
  }
  assert.equal(appVariantForPackage("host.exp.Exponent"), null);
});

test("release channels are fixed and other branches all build Development", () => {
  assert.equal(easUpdatesChannel("v0.2.0"), "stable");
  assert.equal(easUpdatesChannel("0.3.0-preview.1"), "preview");
  assert.equal(easUpdatesChannel("dev"), null);
  for (const branch of ["main", "preview", "feat/foo", "feat-2Ffoo"]) {
    assert.equal(resolveUpdatesChannel("0.1.0", branch), "development");
    assert.equal(resolveUpdatesChannel("0.3.0-preview.1", branch), "development");
  }
  assert.equal(resolveUpdatesChannel("0.1.0", "release/0.1.0"), "stable");
  assert.equal(resolveUpdatesChannel("0.3.0-preview.1", "release/0.3.0"), "preview");
  assert.equal(resolveUpdatesChannel("0.1.0"), "stable");
  assert.equal(resolveUpdatesChannel("0.1.0", "release/0.2.0"), null);
  assert.equal(resolveUpdatesChannel("0.1.0", "release/foo"), null);
});

test("releases require the matching release line and GitHub marker", () => {
  assert.equal(releaseLineBranch("v0.2.0-preview.1"), "release/0.2.0");
  assert.equal(validateReleaseBranch("v0.2.0-preview.1", "refs/heads/release/0.2.0"), null);
  assert.match(validateReleaseBranch("v0.2.0", "main") ?? "", /release\/0\.2\.0/);
  assert.match(validateReleaseBranch("v0.2.1", "release/0.2.0") ?? "", /release\/0\.2\.1/);
  assert.equal(validateReleaseTag("v0.2.0", "0.2.0", false), null);
  assert.equal(validateReleaseTag("v0.2.0-preview.3", "0.2.0-preview.3", true), null);
  assert.match(validateReleaseTag("v0.2.0", "0.2.0", true) ?? "", /preview tag/);
  assert.match(validateReleaseTag("v0.2.0-preview.3", "0.2.0-preview.3", false) ?? "", /plain X\.Y\.Z/);
  assert.match(validateReleaseTag("v0.2.0", "0.1.0", false) ?? "", /does not match/);
});
