/**
 * Build-time facts baked into the artifact: app version + the git commit this
 * bundle/binary was produced from (injected at config-eval time — see
 * app.config.js). Runtime/OTA state (embedded vs OTA, fingerprint, channel,
 * update status) lives in useOtaUpdate().
 */
import Constants from "expo-constants";

export interface BuildInfo {
  version: string;
  /** Running bundle's release, which may be newer than the APK after OTA. */
  releaseVersion: string;
  gitHash: string | null;
  gitHashShort: string | null;
  gitDirty: boolean;
}

interface OrdoExtra {
  gitHash?: string | null;
  gitHashShort?: string | null;
  gitDirty?: boolean;
}

export function useBuildInfo(): BuildInfo {
  const extra = (Constants.expoConfig?.extra as { ordo?: OrdoExtra } | undefined)?.ordo;
  const version = Constants.nativeAppVersion ?? Constants.expoConfig?.version;
  const releaseVersion = Constants.expoConfig?.version ?? version;
  return {
    version: typeof version === "string" && version.length > 0 ? version : "—",
    releaseVersion: typeof releaseVersion === "string" && releaseVersion.length > 0 ? releaseVersion : "—",
    gitHash: typeof extra?.gitHash === "string" && extra.gitHash.length > 0 ? extra.gitHash : null,
    gitHashShort: typeof extra?.gitHashShort === "string" && extra.gitHashShort.length > 0 ? extra.gitHashShort : null,
    gitDirty: extra?.gitDirty === true,
  };
}
