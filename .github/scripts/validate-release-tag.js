#!/usr/bin/env node
/**
 * Keep in sync with apps/mobile/src/lib/app-version.ts
 * (`validateReleaseTag`, `easUpdatesChannel`, `resolveUpdatesChannel`).
 *
 * Usage:
 *   validate-release-tag.js <tag> <appVersion> <githubPrerelease>
 *   validate-release-tag.js --channel <appVersion> [--branch <gitBranch>]
 * githubPrerelease is "true" or "false".
 */
"use strict";

const PREVIEW_UPDATE_BRANCH = "preview";
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

function easUpdatesChannel(appVersion) {
  const classified = classify(appVersion);
  if (!classified) return null;
  return classified.kind === "prerelease" ? "development" : "production";
}

function resolveUpdatesChannel(appVersion, gitBranch) {
  if (gitBranch === PREVIEW_UPDATE_BRANCH) return "preview";
  return easUpdatesChannel(appVersion);
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

if (process.argv[2] === "--channel") {
  const args = process.argv.slice(3);
  let version;
  let branch;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--branch") {
      branch = args[index + 1];
      index += 1;
      continue;
    }
    if (version == null) version = args[index];
  }
  const channel = version ? resolveUpdatesChannel(version, branch) : null;
  if (!channel) {
    console.error(`::error::Cannot map app version '${version ?? ""}' to an EAS channel`);
    process.exit(1);
  }
  process.stdout.write(`${channel}\n`);
  process.exit(0);
}

const [tag, appVersion, prereleaseArg] = process.argv.slice(2);
if (!tag || appVersion == null || prereleaseArg == null) {
  console.error(
    "Usage: validate-release-tag.js <tag> <appVersion> <true|false>\n" +
      "       validate-release-tag.js --channel <appVersion> [--branch <gitBranch>]",
  );
  process.exit(2);
}

const error = validateReleaseTag(tag, appVersion, prereleaseArg === "true");
if (error) {
  console.error(`::error::${error}`);
  process.exit(1);
}
