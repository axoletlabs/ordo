export type PreReleaseChannel = "alpha" | "beta" | "rc";

export interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

export interface ClassifiedReleaseVersion {
  /** Canonical version without a leading `v`. */
  version: string;
  kind: "stable" | "prerelease";
  channel: PreReleaseChannel | null;
  number: number | null;
}

const PRE_CHANNEL_RANK: Record<PreReleaseChannel, number> = {
  alpha: 0,
  beta: 1,
  rc: 2,
};

/** Stable `X.Y.Z` or early `X.Y.Z-(alpha|beta|rc)[.N]`, optional leading `v` / build metadata. */
const RELEASE_VERSION_RE =
  /^v?(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)(?:\.(\d+))?)?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    core: match[1].split(".").map(Number),
    prerelease: match[2]?.split(".") ?? [],
  };
}

function channelRank(part: string): number | null {
  return part in PRE_CHANNEL_RANK ? PRE_CHANNEL_RANK[part as PreReleaseChannel] : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;

  const length = Math.max(a.core.length, b.core.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;

  const prereleaseLength = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart == null) return -1;
    if (bPart == null) return 1;
    if (aPart === bPart) continue;

    const aChannel = channelRank(aPart);
    const bChannel = channelRank(bPart);
    if (aChannel != null && bChannel != null && aChannel !== bChannel) {
      return Math.sign(aChannel - bChannel);
    }

    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : null;
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : null;
    if (aNumber != null && bNumber != null) return Math.sign(aNumber - bNumber);
    if (aNumber != null) return -1;
    if (bNumber != null) return 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function classifyReleaseVersion(value: string): ClassifiedReleaseVersion | null {
  const match = value.trim().match(RELEASE_VERSION_RE);
  if (!match) return null;
  const core = match[1];
  const channel = (match[2] as PreReleaseChannel | undefined) ?? null;
  const numberToken = match[3];
  if (!channel) {
    return { version: core, kind: "stable", channel: null, number: null };
  }
  const suffix = numberToken != null ? `${channel}.${numberToken}` : channel;
  return {
    version: `${core}-${suffix}`,
    kind: "prerelease",
    channel,
    number: numberToken != null ? Number(numberToken) : null,
  };
}

/** GitHub tag `vX.Y.Z` / `vX.Y.Z-beta.N` must match app.config version and the pre-release checkbox. */
export function validateReleaseTag(
  tag: string,
  appVersion: string,
  githubPrerelease: boolean,
): string | null {
  if (tag !== `v${appVersion}`) {
    return `Release tag '${tag}' does not match app version 'v${appVersion}'`;
  }
  const classified = classifyReleaseVersion(appVersion);
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

export interface VersionedRelease {
  version: string;
  /** GitHub pre-release marker. Suffix-only early tags are still treated as early. */
  prerelease: boolean;
  publishedAt: string;
}

export function isEarlyRelease(release: VersionedRelease): boolean {
  if (release.prerelease) return true;
  return classifyReleaseVersion(release.version)?.kind === "prerelease";
}

export function compareReleaseCandidates(left: VersionedRelease, right: VersionedRelease): number {
  const byVersion = compareVersions(left.version, right.version);
  if (byVersion !== 0) return byVersion;
  const leftEarly = isEarlyRelease(left);
  const rightEarly = isEarlyRelease(right);
  if (leftEarly !== rightEarly) return leftEarly ? -1 : 1;
  return new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime();
}

/**
 * Newest installable release for the current binary.
 * Stable-only when `includePrereleases` is off. With it on, alpha < beta < RC <
 * stable of the same core version, so `0.2.0` beats `0.2.0-beta.3`.
 */
export function selectNativeUpdate<T extends VersionedRelease>(
  releases: T[],
  currentVersion: string,
  includePrereleases: boolean,
): T | null {
  let best: T | null = null;
  for (const release of releases) {
    if (!classifyReleaseVersion(release.version)) continue;
    if (!includePrereleases && isEarlyRelease(release)) continue;
    if (!isNewerVersion(release.version, currentVersion)) continue;
    if (!best || compareReleaseCandidates(release, best) > 0) best = release;
  }
  return best;
}
