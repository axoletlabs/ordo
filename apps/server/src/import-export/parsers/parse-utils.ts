/**
 * Shared parsing types + sanitisation helpers for import parsers.
 */
import {
  IMPORT_EXPORT,
  type ImportFormat,
} from "@ordo/shared";

/** One validated source row, ready for preview/commit planning. */
export interface ParsedEntry {
  url: string;
  title: string;
  /** Raw source folder path; flattened to an Ordo folder name at planning time. */
  folderPath: string[];
  tags: string[];
  isRead: boolean;
  readProgress: number;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  readingTimeMinutes: number | null;
}

/** A rejected source row (bounded sample kept for the preview). */
export interface InvalidRow {
  line: number;
  reason: string;
  url: string | null;
}

/** Folder metadata only the Ordo JSON format carries. */
export interface ParsedFolder {
  name: string;
  icon?: string;
  pinned?: boolean;
}

export interface ParseResult {
  format: ImportFormat;
  entries: ParsedEntry[];
  invalid: InvalidRow[];
  folders: ParsedFolder[];
}

/** Reject files that would enqueue tens of thousands of reader fetches. */
export function ensureImportRowBudget(count: number): void {
  if (count >= IMPORT_EXPORT.MAX_BOOKMARK_ROWS) {
    throw new Error(
      `Import files can contain at most ${IMPORT_EXPORT.MAX_BOOKMARK_ROWS} bookmarks.`,
    );
  }
}

/** Flatten nested source folder segments into a single Ordo folder name. */
export function flattenFolderName(segments: readonly string[]): string | null {
  const name = segments
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
    .join(IMPORT_EXPORT.FOLDER_PATH_SEPARATOR)
    .trim()
    .slice(0, IMPORT_EXPORT.FOLDER_NAME_MAX);
  return name.length > 0 ? name : null;
}

/** Trim + collapse whitespace + cap a title. */
export function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, IMPORT_EXPORT.TITLE_MAX);
}

/** Clamp a source reading progress into 0..1. */
export function clampProgress(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Coerce a source date (ISO string, or unix seconds/milliseconds) into an ISO
 * string. Returns null for anything unparseable — the row still imports.
 */
export function coerceDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const ms = raw > 1e11 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{9,13}$/.test(trimmed)) return coerceDate(Number(trimmed));
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** Best-effort domain from a URL, mirroring how bookmarks.service derives it. */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 255);
  }
}

/** Decode the handful of HTML entities bookmark exports actually use. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return "";
  return String.fromCodePoint(value);
}

/**
 * Browser toolbar / "other bookmarks" roots. Netscape files wrap real folders
 * in these; stripping the first matching segment keeps Ordo folders user-named.
 */
const BROWSER_ROOT_FOLDERS = new Set(
  [
    "bookmarks bar",
    "bookmarks toolbar",
    "bookmarks menu",
    "other bookmarks",
    "mobile bookmarks",
    "unsorted bookmarks",
    "favorites bar",
    "autres favoris",
    "weitere lesezeichen",
    "otros marcadores",
    "altri segnalibri",
    "outros favoritos",
    "другие закладки",
    "其他书签",
    "その他のブックマーク",
    "다른 북마크",
  ].map((n) => n.toLocaleLowerCase("en-US")),
);

/** Drop a leading browser-root folder name from a Netscape path. */
export function stripBrowserRootFolders(segments: readonly string[]): string[] {
  if (segments.length === 0) return [];
  const [first, ...rest] = segments;
  if (BROWSER_ROOT_FOLDERS.has(first.trim().toLocaleLowerCase("en-US"))) return rest;
  return [...segments];
}
