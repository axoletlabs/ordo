/** Import preview normalization for clients; no schema dependencies. */
import type { ImportPreviewDto } from "./schemas/import-export.js";

/**
 * Fill fields added after the first import-preview shape so older jobs (and
 * clients talking to an older server) never hand the UI undefined arrays.
 */
export function normalizeImportPreview(
  raw: Partial<ImportPreviewDto> | null | undefined,
): ImportPreviewDto | null {
  if (!raw || typeof raw !== "object") return null;
  const duplicates = raw.duplicates ?? 0;
  const uniqueDuplicates = raw.uniqueDuplicates ?? duplicates;
  return {
    format: raw.format ?? "netscape-html",
    totalRows: raw.totalRows ?? 0,
    validRows: raw.validRows ?? 0,
    invalidRows: raw.invalidRows ?? 0,
    duplicates,
    uniqueNew: raw.uniqueNew ?? Math.max(0, (raw.validRows ?? 0) - uniqueDuplicates),
    uniqueDuplicates,
    withinFileDuplicates: raw.withinFileDuplicates ?? 0,
    newFolders: raw.newFolders ?? [],
    existingFolders: raw.existingFolders ?? [],
    lockedFolderMatches: raw.lockedFolderMatches ?? [],
    invalidSamples: raw.invalidSamples ?? [],
    duplicateSamples: raw.duplicateSamples ?? [],
  };
}
