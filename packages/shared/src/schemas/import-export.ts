/**
 * Import / export schemas and DTOs.
 *
 * Ordo exports are a versioned JSON envelope ("ordo-export", version 1) that
 * preserves every non-content field. Netscape HTML and CSV are lossier
 * interchange formats; imports from them re-extract metadata server-side.
 */
import { z } from "zod";
import {
  DUPLICATE_POLICIES,
  EXPORT_FORMATS,
  IMPORT_EXPORT,
  MAX_TAGS_PER_BOOKMARK,
  TAG_NAME_MAX_LENGTH,
  type DuplicatePolicy,
  type ExportFormat,
  type ImportFormat,
} from "../constants.js";
import { FolderIconSchema } from "./folder.js";

/**
 * Normalize a URL for duplicate matching: lowercase scheme/host, drop default
 * ports, drop a trailing slash on the root path, and drop empty fragments.
 * Query strings and non-root paths are preserved exactly.
 */
export function normalizeUrlForMatch(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  let out = `${url.protocol}//${url.hostname}`;
  const isDefaultPort =
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80");
  if (url.port && !isDefaultPort) out += `:${url.port}`;
  if (url.pathname && url.pathname !== "/") out += url.pathname;
  if (url.search) out += url.search;
  if (url.hash && url.hash !== "#") out += url.hash;
  return out;
}

/** True when a URL is absolute http(s) — the only schemes Ordo stores. */
export function isSupportedUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Flexible date input: ISO strings or unix seconds/milliseconds. Invalid
 * values become null (the row still imports; the date is simply dropped).
 */
const flexibleDate = z
  .union([z.string(), z.number()])
  .transform((value): string | null => {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return null;
      const ms = value > 1e11 ? value : value * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
  })
  .nullable()
  .optional();

export const OrdoExportFolderSchema = z.object({
  name: z.string().trim().min(1).max(IMPORT_EXPORT.FOLDER_NAME_MAX),
  icon: FolderIconSchema.optional(),
  pinned: z.boolean().optional(),
  createdAt: flexibleDate,
});
export type OrdoExportFolder = z.infer<typeof OrdoExportFolderSchema>;

export const OrdoExportBookmarkSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(isSupportedUrl, { message: "Only http(s) URLs can be imported." }),
  title: z.string().max(IMPORT_EXPORT.TITLE_MAX).default(""),
  /** Flattened Ordo folder name; null/omitted means unfiled. */
  folder: z.string().trim().max(IMPORT_EXPORT.FOLDER_NAME_MAX).nullable().optional(),
  tags: z
    .array(z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH))
    .max(MAX_TAGS_PER_BOOKMARK)
    .optional(),
  isRead: z.boolean().optional(),
  readProgress: z.number().min(0).max(1).optional(),
  completedAt: flexibleDate,
  createdAt: flexibleDate,
  updatedAt: flexibleDate,
  description: z.string().max(2000).nullable().optional(),
  author: z.string().max(300).nullable().optional(),
  publishedAt: flexibleDate,
  readingTimeMinutes: z.number().int().min(0).max(10_000).nullable().optional(),
});
export type OrdoExportBookmark = z.infer<typeof OrdoExportBookmarkSchema>;

/** The versioned Ordo export envelope. */
export const OrdoExportFileSchema = z.object({
  format: z.literal("ordo-export"),
  version: z.literal(1),
  exportedAt: z.string(),
  folders: z.array(OrdoExportFolderSchema).max(1000).default([]),
  bookmarks: z.array(OrdoExportBookmarkSchema).max(IMPORT_EXPORT.MAX_BOOKMARK_ROWS),
});
export type OrdoExportFile = z.infer<typeof OrdoExportFileSchema>;

/**
 * Native clients send the file as JSON so Android does not have to attach a
 * Downloads `content://` URI through FormData (that fails as a "network" error).
 */
export const ImportUploadJsonSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  text: z.string().min(1),
});
export type ImportUploadJsonInput = z.infer<typeof ImportUploadJsonSchema>;

/** Options offered at the confirm step of a staged import. */
export const CommitImportSchema = z.object({
  /** What to do when an imported URL already exists in the account. */
  duplicatePolicy: z.enum(DUPLICATE_POLICIES),
  /** Default true: all-or-nothing. Best effort keeps rows that succeed. */
  atomic: z.boolean().default(true),
});
export type CommitImportInput = z.infer<typeof CommitImportSchema>;

export const ExportRequestSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  /** Restrict the export to one folder; omitted/null exports the library. */
  folderId: z.string().min(1).nullable().optional(),
  /** Restrict the export to these folders (no unfiled). Empty/omitted = library. */
  folderIds: z.array(z.string().min(1)).max(1000).optional(),
});
export type ExportRequestInput = z.infer<typeof ExportRequestSchema>;

/**
 * Folder ids to include, or `null` for the whole library (unfiled + eligible
 * folders). `folderIds` and the older single `folderId` are unioned.
 */
export function exportFolderScope(input: ExportRequestInput): string[] | null {
  const ids: string[] = [];
  if (input.folderIds) {
    for (const id of input.folderIds) {
      if (id) ids.push(id);
    }
  }
  if (input.folderId) ids.push(input.folderId);
  const unique = [...new Set(ids)];
  return unique.length > 0 ? unique : null;
}

export type ImportJobStatus = "parsing" | "ready" | "committing" | "completed" | "failed";

/** One rejected source row: where it came from and why. */
export interface ImportInvalidSample {
  line: number;
  reason: string;
  url: string | null;
}

/** A URL from the file that already exists in the library (preview sample). */
export interface ImportDuplicateSample {
  url: string;
  title: string;
}

/** Summary computed after parsing, shown before confirming an import. */
export interface ImportPreviewDto {
  format: ImportFormat;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  /** Rows whose normalized URL already exists in the account. */
  duplicates: number;
  /** Distinct URLs in the file that are new to the library. */
  uniqueNew: number;
  /** Distinct URLs in the file that already exist in the library. */
  uniqueDuplicates: number;
  /** Repeats of the same normalized URL within the file itself. */
  withinFileDuplicates: number;
  newFolders: string[];
  existingFolders: string[];
  /** Existing protected folders matched by name — unlock to import into them. */
  lockedFolderMatches: string[];
  invalidSamples: ImportInvalidSample[];
  duplicateSamples: ImportDuplicateSample[];
}

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

/** Live background article-fetch progress for the signed-in user. */
export interface ExtractionProgressDto {
  pending: number;
  total: number;
  completed: number;
}

/** Row-level outcome after a commit. */
export interface ImportResultDto {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  foldersCreated: number;
  atomic: boolean;
  duplicatePolicy: DuplicatePolicy;
  /** Best-effort mode: per-row failures (atomic mode reports none). */
  failures: ImportInvalidSample[];
}

export interface ImportJobDto {
  id: string;
  status: ImportJobStatus;
  fileName: string | null;
  createdAt: string;
  expiresAt: string;
  preview: ImportPreviewDto | null;
  /** Human-readable reason when status is "failed". */
  failure: string | null;
  result: ImportResultDto | null;
}

export type { DuplicatePolicy, ExportFormat, ImportFormat };
