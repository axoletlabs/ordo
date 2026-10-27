/**
 * Display name for a published version: "0.3.0 Preview 2", the name used in
 * published release headings — never the raw "v0.3.0-preview.2" development tag.
 */
import { classifyReleaseVersion } from "./app-version";

export function releaseName(version: string): string {
  const classified = classifyReleaseVersion(version);
  if (!classified) return version.trim().replace(/^v(?=\d)/, "");
  const line = classified.version.split("-")[0];
  return classified.kind === "stable"
    ? line
    : `${line} Preview${classified.number != null ? ` ${classified.number}` : ""}`;
}
