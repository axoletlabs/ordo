import assert from "node:assert/strict";
import { test } from "node:test";
import { selectNativeUpdate, type VersionedRelease } from "./app-version.ts";

function rel(version: string, prerelease = version.includes("-")): VersionedRelease {
  return { version, prerelease, publishedAt: "2026-01-01T00:00:00Z" };
}

test("Stable only offers newer Stable releases", () => {
  assert.equal(selectNativeUpdate([rel("0.3.0-preview.1"), rel("0.2.0"), rel("0.1.5")], "0.1.0", "stable")?.version, "0.2.0");
  assert.equal(selectNativeUpdate([rel("0.3.0-preview.1")], "0.1.0", "stable"), null);
});

test("Preview only offers Preview, never the matching or newer Stable", () => {
  assert.equal(selectNativeUpdate([rel("0.2.0"), rel("0.3.0"), rel("0.2.0-preview.10")], "0.2.0-preview.2", "preview")?.version, "0.2.0-preview.10");
  assert.equal(selectNativeUpdate([rel("0.2.0"), rel("0.3.0")], "0.2.0-preview.2", "preview"), null);
});

test("Preview sequences compare numerically and never downgrade", () => {
  assert.equal(selectNativeUpdate([rel("0.2.0-preview.9"), rel("0.2.0-preview.10")], "0.2.0-preview.3", "preview")?.version, "0.2.0-preview.10");
  assert.equal(selectNativeUpdate([rel("0.2.0-preview.10")], "0.3.0-preview.1", "preview"), null);
});

test("Development never receives published APK updates", () => {
  assert.equal(selectNativeUpdate([rel("0.2.0"), rel("0.3.0-preview.1")], "0.1.0", "development"), null);
});

test("legacy channels, malformed versions and inconsistent markers are rejected", () => {
  for (const variant of ["stable", "preview"] as const) {
    assert.equal(selectNativeUpdate([rel("dev"), rel("0.2.0-beta.1"), rel("0.2.0-alpha.1"), rel("0.2.0-rc.1"), rel("0.2.0", true), rel("0.2.0-preview.1", false)], "0.1.0", variant), null);
  }
});
