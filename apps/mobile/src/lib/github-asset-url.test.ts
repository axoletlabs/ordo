import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTrustedGithubAssetUrl,
  isTrustedGithubReleasePageUrl,
} from "./github-asset-url.ts";

test("accepts https GitHub release download URLs for this repo", () => {
  assert.equal(
    isTrustedGithubAssetUrl(
      "https://github.com/axoletlabs/ordo/releases/download/v0.1.0/ordo.apk",
    ),
    true,
  );
  assert.equal(
    isTrustedGithubAssetUrl(
      "https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/abc",
    ),
    true,
  );
  assert.equal(
    isTrustedGithubAssetUrl("https://release-assets.githubusercontent.com/123/ordo.apk"),
    true,
  );
});

test("rejects http, other hosts, and other GitHub repos", () => {
  assert.equal(
    isTrustedGithubAssetUrl(
      "http://github.com/axoletlabs/ordo/releases/download/v0.1.0/ordo.apk",
    ),
    false,
  );
  assert.equal(
    isTrustedGithubAssetUrl(
      "https://github.com/evil/ordo/releases/download/v0.1.0/ordo.apk",
    ),
    false,
  );
  assert.equal(
    isTrustedGithubAssetUrl("https://evil.com/axoletlabs/ordo/releases/download/v0.1.0/ordo.apk"),
    false,
  );
  assert.equal(
    isTrustedGithubAssetUrl("https://raw.githubusercontent.com/axoletlabs/ordo/main/ordo.apk"),
    false,
  );
  assert.equal(isTrustedGithubAssetUrl("not-a-url"), false);
});

test("release pages must be https github.com/axoletlabs/ordo", () => {
  assert.equal(
    isTrustedGithubReleasePageUrl("https://github.com/axoletlabs/ordo/releases/tag/v0.1.0"),
    true,
  );
  assert.equal(
    isTrustedGithubReleasePageUrl("https://github.com/evil/ordo/releases/tag/v0.1.0"),
    false,
  );
});
