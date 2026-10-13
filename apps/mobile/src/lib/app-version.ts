// Shared with CI, Expo config and the self-hosted server installer.
export {
  APP_VARIANTS, appVariantForPackage, releaseMatchesVariant,
  classifyReleaseVersion, parseVersion, compareVersions, isNewerVersion,
  easUpdatesChannel, releaseLineBranch, resolveUpdatesChannel,
  validateReleaseBranch, validateReleaseTag, isEarlyRelease,
  compareReleaseCandidates, selectNativeUpdate,
} from "../../../../scripts/release-policy.js";
export type {
  AppVariant,
  PreReleaseChannel, ParsedVersion, ClassifiedReleaseVersion,
  EasUpdateChannel, VersionedRelease,
} from "../../../../scripts/release-policy.js";
