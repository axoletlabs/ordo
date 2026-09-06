/**
 * CSV parser: an RFC 4180 tokenizer (quoted fields, escaped quotes, CRLF)
 * plus header-profile detection for the exports Ordo understands:
 *
 *  - Ordo's own CSV (url,title,folder,tags,isRead,readProgress,…)
 *  - Raindrop.io (link/title, folder, tags, created_at as unix seconds)
 *  - Pocket (url, time_added, status: unread|archive)
 *  - Instapaper (URL, Title, Folder with Unread/Archive sentinels)
 */
import { APP_NAME, isSupportedUrl } from "@ordo/shared";
import type { InvalidRow, ParseResult, ParsedEntry } from "./parse-utils";
import { clampProgress, coerceDate, sanitizeTitle } from "./parse-utils";

/** Split CSV text into rows of cells. Handles quotes, escaped quotes, CRLF. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

type Profile = "ordo" | "raindrop" | "pocket" | "instapaper";

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, "");

/** Detect which known export produced this header row, if any. */
export function detectCsvProfile(header: string[]): Profile | null {
  const cols = new Set(header.map(norm));
  if (cols.has("url") && (cols.has("readprogress") || cols.has("readingtimeminutes"))) {
    return "ordo";
  }
  if (cols.has("timeadded") || cols.has("time_added")) return "pocket";
  if (cols.has("tags") && (cols.has("createdat") || cols.has("created_at") || cols.has("link"))) {
    return "raindrop";
  }
  const urlCol = cols.has("url") || cols.has("link");
  if (urlCol && cols.has("title") && cols.has("folder")) return "instapaper";
  return null;
}

function columnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = norm(h);
    if (!(key in map)) map[key] = i;
  });
  return map;
}

const cell = (row: string[], map: Record<string, number>, ...keys: string[]): string => {
  for (const key of keys) {
    const idx = map[key];
    if (idx !== undefined && idx < row.length) return (row[idx] ?? "").trim();
  }
  return "";
};

/** Parse CSV text; throws when no known profile matches the header row. */
export function parseCsv(text: string): ParseResult {
  const rows = splitCsv(text);
  if (rows.length === 0) throw new Error("The CSV file is empty.");

  const header = rows[0];
  const profile = detectCsvProfile(header);
  if (!profile) {
    throw new Error(
      `Unrecognised CSV columns. Use an ${APP_NAME}, Raindrop.io, Pocket, or Instapaper export.`,
    );
  }

  const map = columnMap(header);
  const entries: ParsedEntry[] = [];
  const invalid: InvalidRow[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const line = r + 1;

    const url = cell(row, map, "url", "link", "href");
    if (!url) {
      invalid.push({ line, reason: "Missing URL.", url: null });
      continue;
    }
    if (!isSupportedUrl(url)) {
      invalid.push({ line, reason: "Only http(s) URLs can be imported.", url: url.slice(0, 200) });
      continue;
    }
    if (url.length > 2048) {
      invalid.push({ line, reason: "URL is longer than 2048 characters.", url: url.slice(0, 200) });
      continue;
    }

    const title = sanitizeTitle(cell(row, map, "title"));

    let folderRaw = cell(row, map, "folder", "collection");
    let isRead = false;
    let createdAt: string | null = null;
    let tags: string[] = [];
    let readProgress = 0;
    let completedAt: string | null = null;
    let description: string | null = null;
    let author: string | null = null;
    let publishedAt: string | null = null;
    let readingTimeMinutes: number | null = null;

    if (profile === "instapaper" && (folderRaw === "Archive" || folderRaw === "Unread")) {
      isRead = folderRaw === "Archive";
      folderRaw = "";
    }
    if (profile === "pocket") {
      isRead = cell(row, map, "status") === "archive";
      createdAt = coerceDate(cell(row, map, "timeadded", "time_added"));
    }
    if (profile === "raindrop") {
      createdAt = coerceDate(cell(row, map, "createdat", "created_at"));
      tags = cell(row, map, "tags")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 20);
    }
    if (profile === "ordo") {
      isRead = cell(row, map, "isread").toLowerCase() === "true";
      readProgress = clampProgress(Number(cell(row, map, "readprogress")) || 0);
      completedAt = coerceDate(cell(row, map, "completedat"));
      createdAt = coerceDate(cell(row, map, "createdat"));
      description = cell(row, map, "description") || null;
      author = cell(row, map, "author") || null;
      publishedAt = coerceDate(cell(row, map, "publishedat"));
      const minutes = Number(cell(row, map, "readingtimeminutes"));
      readingTimeMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null;
      tags = cell(row, map, "tags")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 20);
    }

    const folderPath = folderRaw
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    entries.push({
      url,
      title,
      folderPath,
      tags,
      isRead,
      readProgress,
      completedAt: completedAt ?? (isRead ? createdAt : null),
      createdAt,
      updatedAt: createdAt,
      description,
      author,
      publishedAt,
      readingTimeMinutes,
    });
  }

  return { format: "csv", entries, invalid, folders: [] };
}
