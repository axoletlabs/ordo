import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyReleaseVersion,
  compareVersions,
  isNewerVersion,
  validateReleaseTag,
} from "./app-version.ts";

test("stable outranks a pre-release of the same core version", () => {
  assert.equal(compareVersions("0.2.0", "0.2.0-beta.3") > 0, true);
  assert.equal(isNewerVersion("0.2.0-beta.3", "0.2.0"), false);
  assert.equal(isNewerVersion("0.2.0", "0.2.0-beta.3"), true);
});

test("early channels rank alpha < beta < RC", () => {
  assert.equal(compareVersions("0.2.0-alpha.8", "0.2.0-beta.1") < 0, true);
  assert.equal(compareVersions("0.2.0-beta.99", "0.2.0-rc.1") < 0, true);
  assert.equal(compareVersions("0.2.0-rc.1", "0.2.0") < 0, true);
});

test("pre-release numbers compare numerically", () => {
  assert.equal(compareVersions("0.2.0-beta.3", "0.2.0-beta.10") < 0, true);
  assert.equal(isNewerVersion("0.2.0-beta.10", "0.2.0-beta.3"), true);
});

test("a pre-release of the next core version outranks the current stable", () => {
  assert.equal(isNewerVersion("0.3.0-alpha.1", "0.2.0"), true);
  assert.equal(isNewerVersion("0.2.0", "0.3.0-alpha.1"), false);
});

test("classifyReleaseVersion accepts only stable and alpha/beta/rc tags", () => {
  assert.deepEqual(classifyReleaseVersion("v0.2.0"), {
    version: "0.2.0",
    kind: "stable",
    channel: null,
    number: null,
  });
  assert.equal(classifyReleaseVersion("0.2.0-beta.3")?.kind, "prerelease");
  assert.equal(classifyReleaseVersion("0.2.0-beta.3")?.channel, "beta");
  assert.equal(classifyReleaseVersion("0.2.0-rc")?.number, null);
  assert.equal(classifyReleaseVersion("dev"), null);
  assert.equal(classifyReleaseVersion("0.2.0-preview.1"), null);
});

test("validateReleaseTag keeps the GitHub pre-release checkbox aligned with the tag", () => {
  assert.equal(validateReleaseTag("v0.2.0", "0.2.0", false), null);
  assert.equal(validateReleaseTag("v0.2.0-beta.3", "0.2.0-beta.3", true), null);
  assert.match(validateReleaseTag("v0.2.0", "0.2.0", true) ?? "", /alpha, beta, or RC/);
  assert.match(validateReleaseTag("v0.2.0-beta.3", "0.2.0-beta.3", false) ?? "", /plain X\.Y\.Z/);
  assert.match(validateReleaseTag("v0.2.0", "0.1.0", false) ?? "", /does not match/);
});
