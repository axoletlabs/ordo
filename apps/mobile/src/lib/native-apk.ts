import { isTrustedGithubAssetUrl } from "./github-asset-url";

export interface GithubApkAsset {
  name?: string;
  state?: string;
  size?: number;
  browser_download_url?: string;
}

/** Select only this version's official APKs, in the device's ABI order. */
export function selectReleaseApk(assets: GithubApkAsset[], version: string, architectures: string[]): GithubApkAsset | null {
  const prefix = `ordo-v${version}`;
  const uploaded = assets.filter((asset) =>
    asset.state === "uploaded" && typeof asset.browser_download_url === "string" &&
    isTrustedGithubAssetUrl(asset.browser_download_url) &&
    Number.isSafeInteger(asset.size) && (asset.size ?? 0) > 0,
  );
  for (const value of architectures) {
    const architecture = value.toLowerCase();
    const abi = architecture.includes("arm64") || architecture === "aarch64" ? "arm64-v8a"
      : architecture.includes("armeabi") || architecture === "armv7l" ? "armeabi-v7a"
      : architecture.includes("x86_64") || architecture.includes("x86-64") ? "x86_64"
      : architecture.includes("x86") ? "x86" : null;
    if (!abi) continue;
    const match = uploaded.find((asset) => asset.name === `${prefix}-${abi}.apk`);
    if (match) return match;
  }
  return uploaded.find((asset) => asset.name === `${prefix}.apk`) ?? null;
}
