"use strict";

// One policy for CI, Expo config, the app updater, and self-hosted releases.
const NUMBER = "(?:0|[1-9][0-9]*)";
const RELEASE_VERSION_RE = new RegExp(
  `^v?(${NUMBER}\\.${NUMBER}\\.${NUMBER})(?:-(alpha|beta|rc)(?:\\.(${NUMBER}))?)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

function classifyReleaseVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(RELEASE_VERSION_RE);
  if (!match) return null;
  if (![...match[1].split("."), ...(match[3] ? [match[3]] : [])].every((part) => Number.isSafeInteger(Number(part)))) return null;
  const channel = match[2] ?? null;
  return {
    version: match[1] + (channel ? `-${channel}${match[3] != null ? `.${match[3]}` : ""}` : ""),
    kind: channel ? "prerelease" : "stable",
    channel,
    number: match[3] != null ? Number(match[3]) : null,
  };
}

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) return null;
  const core = match[1].split(".").map(Number);
  if (!core.every(Number.isSafeInteger)) return null;
  return { core, prerelease: match[2]?.split(".") ?? [] };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i += 1) {
    const difference = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x == null) return -1;
    if (y == null) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return x.length === y.length ? (x < y ? -1 : 1) : Math.sign(x.length - y.length);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function easUpdatesChannel(version) {
  const classified = classifyReleaseVersion(version);
  return classified ? (classified.kind === "stable" ? "production" : "early-access") : null;
}

function releaseLineBranch(version) {
  const classified = classifyReleaseVersion(version);
  return classified ? `release/${classified.version.split("-")[0]}` : null;
}

function resolveUpdatesChannel(version, branch) {
  if (!classifyReleaseVersion(version)) return null;
  branch = branch?.replace(/^refs\/heads\//, "");
  if (!branch) return easUpdatesChannel(version);
  if (branch === "main") return "development";
  if (branch.startsWith("release/")) {
    return branch === releaseLineBranch(version) ? easUpdatesChannel(version) : null;
  }
  // Escape '-' too, so feat/foo and feat-2Ffoo cannot collide. Feature APKs
  // never subscribe to main, even when they share a native fingerprint.
  return `development-${encodeURIComponent(branch).replace(/-/g, "%2D").replace(/%/g, "-")}`;
}

function validateReleaseBranch(tag, target) {
  const expected = releaseLineBranch(tag);
  if (!expected) return `Tag '${tag}' is not vX.Y.Z. Version releases use a release/x.y.z branch.`;
  if (String(target ?? "").trim().replace(/^refs\/heads\//, "") !== expected) {
    return `Publish ${tag} from ${expected}. main does not publish version releases. Push the commit to ${expected}, then tag it there.`;
  }
  return null;
}

function validateReleaseTag(tag, version, prerelease) {
  if (tag !== `v${version}`) return `Release tag '${tag}' does not match app version 'v${version}'`;
  const classified = classifyReleaseVersion(version);
  if (!classified || classified.version !== version) return `App version '${version}' must be X.Y.Z or X.Y.Z-(alpha|beta|rc)[.N]`;
  if (prerelease && classified.kind !== "prerelease") return `GitHub pre-releases must use an alpha, beta, or RC tag (got '${version}')`;
  if (!prerelease && classified.kind !== "stable") return `Stable GitHub releases must use a plain X.Y.Z tag (got '${version}')`;
  return null;
}

function isEarlyRelease(release) {
  return !!release.prerelease || classifyReleaseVersion(release.version)?.kind === "prerelease";
}

function compareReleaseCandidates(left, right) {
  const byVersion = compareVersions(left.version, right.version);
  if (byVersion) return byVersion;
  if (isEarlyRelease(left) !== isEarlyRelease(right)) return isEarlyRelease(left) ? -1 : 1;
  return (Date.parse(left.publishedAt) || 0) - (Date.parse(right.publishedAt) || 0);
}

function selectNativeUpdate(releases, current, includePrereleases) {
  let best = null;
  for (const release of releases) {
    if (!classifyReleaseVersion(release.version)) continue;
    if (!includePrereleases && isEarlyRelease(release)) continue;
    if (!isNewerVersion(release.version, current)) continue;
    if (!best || compareReleaseCandidates(release, best) > 0) best = release;
  }
  return best;
}

module.exports = {
  classifyReleaseVersion, parseVersion, compareVersions, isNewerVersion,
  easUpdatesChannel, releaseLineBranch, resolveUpdatesChannel,
  validateReleaseBranch, validateReleaseTag, isEarlyRelease,
  compareReleaseCandidates, selectNativeUpdate,
};
