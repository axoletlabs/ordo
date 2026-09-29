export type PreReleaseChannel = "alpha" | "beta" | "rc";
export interface ParsedVersion { core: number[]; prerelease: string[] }
export interface ClassifiedReleaseVersion {
  version: string;
  kind: "stable" | "prerelease";
  channel: PreReleaseChannel | null;
  number: number | null;
}
export type EasUpdateChannel = "production" | "development" | "early-access" | `development-${string}`;
export interface VersionedRelease { version: string; prerelease: boolean; publishedAt: string }
export function classifyReleaseVersion(value: string): ClassifiedReleaseVersion | null;
export function parseVersion(value: string): ParsedVersion | null;
export function compareVersions(left: string, right: string): number;
export function isNewerVersion(candidate: string, current: string): boolean;
export function easUpdatesChannel(version: string): "production" | "early-access" | null;
export function releaseLineBranch(version: string): string | null;
export function resolveUpdatesChannel(version: string, branch?: string | null): EasUpdateChannel | null;
export function validateReleaseBranch(tag: string, target: string): string | null;
export function validateReleaseTag(tag: string, version: string, prerelease: boolean): string | null;
export function isEarlyRelease(release: VersionedRelease): boolean;
export function compareReleaseCandidates(left: VersionedRelease, right: VersionedRelease): number;
export function selectNativeUpdate<T extends VersionedRelease>(releases: T[], current: string, includePrereleases: boolean): T | null;
