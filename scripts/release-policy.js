"use strict";

// One policy for CI, Expo config, the app updater, and self-hosted releases.
const NUMBER = "(?:0|[1-9][0-9]*)";
const RELEASE_VERSION_RE = new RegExp(
  `^v?(${NUMBER}\\.${NUMBER}\\.${NUMBER})(?:-(preview)(?:\\.(${NUMBER}))?)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

// Fixed native identities. Never choose an app's update stream from a preference
// or from an OTA manifest: it belongs to the installed binary.
const APP_VARIANTS = {
  stable: { name: "ordo", package: "com.axolet.ordo", channel: "stable", apkPrefix: "ordo" },
  preview: { name: "ordo (preview)", package: "com.axolet.ordo.preview", channel: "preview", apkPrefix: "ordo-preview" },
  development: { name: "ordo (dev)", package: "com.axolet.ordo.development", channel: null, apkPrefix: "ordo-development" },
};

function appVariantForPackage(packageName) {
  return Object.keys(APP_VARIANTS).find((variant) => APP_VARIANTS[variant].package === packageName) ?? null;
}

function releaseMatchesVariant(release, variant) {
  const classified = classifyReleaseVersion(release.version);
  if (!classified || variant === "development") return false;
  return variant === "preview"
    ? classified.channel === "preview" && !!release.prerelease
    : variant === "stable" && classified.kind === "stable" && !release.prerelease;
}

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

// Preview APK build numbers must never fall backwards across release lines:
// Android refuses to replace an installed versionCode with a lower one, so a
// line that restarted at Preview 1 could not upgrade the previous line's
// previews in place. Each line starts after every preview code earlier lines
// shipped; the release pipeline test holds this table against tag history.
const PREVIEW_CODE_BASES = { "0.3": 2 };

function releaseLineOf(value) {
  const classified = typeof value === "string" ? classifyReleaseVersion(value) : value;
  return classified ? classified.version.split("-")[0].split(".").slice(0, 2).join(".") : null;
}

/** Stable/Preview Android versionCode. Development returns null (run number). */
function androidBuildNumber(value) {
  const classified = typeof value === "string" ? classifyReleaseVersion(value) : value;
  if (!classified) return null;
  if (classified.kind === "stable") return 1;
  if (classified.channel !== "preview") return null;
  return (PREVIEW_CODE_BASES[releaseLineOf(classified)] ?? 0) + (classified.number ?? 0);
}

function easUpdatesChannel(version) {
  const classified = classifyReleaseVersion(version);
  return classified ? (classified.kind === "stable" ? "stable" : "preview") : null;
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
  return "development";
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
  if (!classified || classified.version !== version) return `App version '${version}' must be X.Y.Z or X.Y.Z-preview[.N]`;
  if (prerelease && classified.kind !== "prerelease") return `GitHub pre-releases must use a preview tag (got '${version}')`;
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

function selectNativeUpdate(releases, current, variant) {
  let best = null;
  for (const release of releases) {
    if (!releaseMatchesVariant(release, variant)) continue;
    if (!isNewerVersion(release.version, current)) continue;
    if (!best || compareReleaseCandidates(release, best) > 0) best = release;
  }
  return best;
}

module.exports = {
  APP_VARIANTS, appVariantForPackage, releaseMatchesVariant,
  classifyReleaseVersion, parseVersion, compareVersions, isNewerVersion,
  PREVIEW_CODE_BASES, releaseLineOf, androidBuildNumber,
  easUpdatesChannel, releaseLineBranch, resolveUpdatesChannel,
  validateReleaseBranch, validateReleaseTag, isEarlyRelease,
  compareReleaseCandidates, selectNativeUpdate,
};
