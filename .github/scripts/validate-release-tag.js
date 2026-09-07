#!/usr/bin/env node
/**
 * Keep in sync with apps/mobile/src/lib/app-version.ts (`validateReleaseTag`).
 *
 * Usage: validate-release-tag.js <tag> <appVersion> <githubPrerelease>
 * githubPrerelease is "true" or "false".
 */
"use strict";

const RELEASE_VERSION_RE =
  /^v?(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)(?:\.(\d+))?)?(?:\+[0-9A-Za-z.-]+)?$/;

function classify(value) {
  const match = String(value).trim().match(RELEASE_VERSION_RE);
  if (!match) return null;
  const core = match[1];
  const channel = match[2] ?? null;
  const numberToken = match[3];
  if (!channel) return { version: core, kind: "stable" };
  const suffix = numberToken != null ? `${channel}.${numberToken}` : channel;
  return { version: `${core}-${suffix}`, kind: "prerelease" };
}

function validateReleaseTag(tag, appVersion, githubPrerelease) {
  if (tag !== `v${appVersion}`) {
    return `Release tag '${tag}' does not match app version 'v${appVersion}'`;
  }
  const classified = classify(appVersion);
  if (!classified || classified.version !== appVersion) {
    return `App version '${appVersion}' must be X.Y.Z or X.Y.Z-(alpha|beta|rc)[.N]`;
  }
  if (githubPrerelease && classified.kind !== "prerelease") {
    return `GitHub pre-releases must use an alpha, beta, or RC tag (got '${appVersion}')`;
  }
  if (!githubPrerelease && classified.kind !== "stable") {
    return `Stable GitHub releases must use a plain X.Y.Z tag (got '${appVersion}')`;
  }
  return null;
}

const [tag, appVersion, prereleaseArg] = process.argv.slice(2);
if (!tag || appVersion == null || prereleaseArg == null) {
  console.error("Usage: validate-release-tag.js <tag> <appVersion> <true|false>");
  process.exit(2);
}

const error = validateReleaseTag(tag, appVersion, prereleaseArg === "true");
if (error) {
  console.error(`::error::${error}`);
  process.exit(1);
}
