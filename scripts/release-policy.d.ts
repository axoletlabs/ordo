export type AppVariant = "stable" | "preview" | "development";
export type PreReleaseChannel = "preview";
export const APP_VARIANTS: Record<AppVariant, { name: string; package: string; channel: "stable" | "preview" | null; apkPrefix: string }>;
export function appVariantForPackage(packageName: string | null | undefined): AppVariant | null;
export function releaseMatchesVariant(release: VersionedRelease, variant: AppVariant): boolean;
export interface ParsedVersion { core: number[]; prerelease: string[] }
export interface ClassifiedReleaseVersion {
  version: string;
  kind: "stable" | "prerelease";
  channel: PreReleaseChannel | null;
  number: number | null;
}
export type EasUpdateChannel = "stable" | "preview" | "development";
export interface VersionedRelease { version: string; prerelease: boolean; publishedAt: string }
export function classifyReleaseVersion(value: string): ClassifiedReleaseVersion | null;
export function parseVersion(value: string): ParsedVersion | null;
export function compareVersions(left: string, right: string): number;
export function isNewerVersion(candidate: string, current: string): boolean;
export function easUpdatesChannel(version: string): "stable" | "preview" | null;
export function releaseLineBranch(version: string): string | null;
export function resolveUpdatesChannel(version: string, branch?: string | null): EasUpdateChannel | null;
export function validateReleaseBranch(tag: string, target: string): string | null;
export function validateReleaseTag(tag: string, version: string, prerelease: boolean): string | null;
export function isEarlyRelease(release: VersionedRelease): boolean;
export function compareReleaseCandidates(left: VersionedRelease, right: VersionedRelease): number;
export function selectNativeUpdate<T extends VersionedRelease>(releases: T[], current: string, variant: AppVariant): T | null;
