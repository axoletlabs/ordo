/**
 * Ordo JSON import parser: validates the versioned envelope, then each row
 * individually so one bad bookmark does not sink the whole file.
 */
import {
  APP_NAME,
  OrdoExportBookmarkSchema,
  OrdoExportFolderSchema,
  isSupportedUrl,
} from "@ordo/shared";
import type { InvalidRow, ParseResult, ParsedEntry } from "./parse-utils";
import { clampProgress, sanitizeTitle } from "./parse-utils";

/** Returns true when the text parses as an Ordo export envelope. */
export function looksLikeOrdoJson(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    const value = JSON.parse(trimmed) as { format?: unknown };
    return value?.format === "ordo-export";
  } catch {
    return false;
  }
}

/** Parse an Ordo export file. Throws when the envelope itself is invalid. */
export function parseOrdoJson(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const envelope = value as { format?: unknown; version?: unknown; folders?: unknown; bookmarks?: unknown };
  if (envelope?.format !== "ordo-export") {
    throw new Error(`The JSON file is not an ${APP_NAME} export.`);
  }
  if (envelope.version !== 1) {
    throw new Error(`Unsupported ${APP_NAME} export version: ${String(envelope.version)}`);
  }
  if (!Array.isArray(envelope.bookmarks)) {
    throw new Error(`The ${APP_NAME} export is missing its bookmarks list.`);
  }

  const entries: ParsedEntry[] = [];
  const invalid: InvalidRow[] = [];

  (envelope.bookmarks as unknown[]).forEach((raw, index) => {
    const line = index + 2; // header line + 1-based rows
    const parsed = OrdoExportBookmarkSchema.safeParse(raw);
    if (!parsed.success) {
      const url =
        raw && typeof raw === "object" && typeof (raw as { url?: unknown }).url === "string"
          ? ((raw as { url: string }).url.slice(0, 200) as string)
          : null;
      invalid.push({
        line,
        reason: parsed.error.issues[0]?.message ?? "Invalid bookmark row.",
        url,
      });
      return;
    }
    const b = parsed.data;
    const url = b.url.trim();
    if (!isSupportedUrl(url) || url.length > 2048) {
      invalid.push({ line, reason: "Only http(s) URLs can be imported.", url: url.slice(0, 200) });
      return;
    }
    entries.push({
      url,
      title: sanitizeTitle(b.title),
      folderPath: b.folder ? [b.folder] : [],
      tags: (b.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 20),
      isRead: b.isRead ?? false,
      readProgress: clampProgress(b.readProgress ?? (b.isRead ? 1 : 0)),
      completedAt: b.completedAt ?? null,
      createdAt: b.createdAt ?? null,
      updatedAt: b.updatedAt ?? null,
      description: b.description ?? null,
      author: b.author ?? null,
      publishedAt: b.publishedAt ?? null,
      readingTimeMinutes: b.readingTimeMinutes ?? null,
    });
  });

  const folders: ParseResult["folders"] = [];
  if (Array.isArray(envelope.folders)) {
    (envelope.folders as unknown[]).forEach((raw) => {
      const parsed = OrdoExportFolderSchema.safeParse(raw);
      if (parsed.success) {
        folders.push({
          name: parsed.data.name,
          ...(parsed.data.icon ? { icon: parsed.data.icon } : {}),
          ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
        });
      }
    });
  }

  return { format: "ordo-json", entries, invalid, folders };
}
