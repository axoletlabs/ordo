/** In-app APK downloads must stay on ordo's GitHub release assets. */

const ORDO_GITHUB_PREFIX = "/axoletlabs/ordo/";

const GITHUB_RELEASE_ASSET_HOSTS = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

export function isTrustedGithubAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "github.com") {
      return parsed.pathname.startsWith(ORDO_GITHUB_PREFIX);
    }
    return GITHUB_RELEASE_ASSET_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function isTrustedGithubReleasePageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "github.com" &&
      parsed.pathname.startsWith(ORDO_GITHUB_PREFIX)
    );
  } catch {
    return false;
  }
}
