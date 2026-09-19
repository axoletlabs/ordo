import { tagNameKey } from "@ordo/shared";
import {
  decryptOptional,
  decryptText,
  encryptText,
  fieldAad,
  isLibraryCiphertext,
  tagBlindIndex,
  type LibraryFieldKind,
} from "./library-crypto.js";

const BOOKMARK_TEXT_FIELDS = [
  "url",
  "title",
  "description",
  "domain",
  "contentHtml",
  "author",
  "articleUndoSnapshot",
] as const;

const HIGHLIGHT_TEXT_FIELDS = ["exact", "prefix", "suffix", "href"] as const;
const IMPORT_TEXT_FIELDS = ["entries", "preview", "result", "failure"] as const;

type TextRecord = Record<string, unknown>;

export function sealString(
  dek: Buffer | null,
  value: string,
  kind: LibraryFieldKind,
  userId: string,
  id: string,
  field: string,
): string {
  if (!dek) return value;
  if (isLibraryCiphertext(value)) return value;
  return encryptText(dek, value, fieldAad(kind, userId, id, field));
}

export function openString(
  dek: Buffer | null,
  value: string,
  kind: LibraryFieldKind,
  userId: string,
  id: string,
  field: string,
): string {
  return decryptText(dek, value, fieldAad(kind, userId, id, field));
}

export function sealBookmark<T extends TextRecord>(dek: Buffer | null, userId: string, id: string, row: T): T {
  return sealFields(dek, row, "bookmark", userId, id, BOOKMARK_TEXT_FIELDS);
}

export function openBookmark<T extends TextRecord>(dek: Buffer | null, row: T): T {
  const userId = stringField(row, "userId");
  const id = stringField(row, "id");
  if (!userId || !id) return row;
  const next = openFields(dek, row, "bookmark", userId, id, BOOKMARK_TEXT_FIELDS);
  return openNestedTagsAndHighlights(dek, userId, next);
}

export function sealFolderName(dek: Buffer | null, userId: string, id: string, name: string): string {
  return sealString(dek, name, "folder", userId, id, "name");
}

export function openFolder<T extends TextRecord>(dek: Buffer | null, row: T): T {
  const userId = stringField(row, "userId");
  const id = stringField(row, "id");
  const name = stringField(row, "name");
  if (!userId || !id || name == null) return row;
  return { ...row, name: openString(dek, name, "folder", userId, id, "name") };
}

export function sealTag<T extends { name: string; normalizedName?: string }>(
  dek: Buffer | null,
  userId: string,
  id: string,
  row: T,
): T & { name: string; normalizedName: string } {
  const normalized = row.normalizedName ?? tagNameKey(row.name);
  return {
    ...row,
    name: sealString(dek, row.name, "tag", userId, id, "name"),
    normalizedName: dek ? tagBlindIndex(dek, userId, normalized) : normalized,
  };
}

export function openTag<T extends TextRecord>(dek: Buffer | null, row: T): T {
  const userId = stringField(row, "userId");
  const id = stringField(row, "id");
  const name = stringField(row, "name");
  if (!userId || !id || name == null) return row;
  return { ...row, name: openString(dek, name, "tag", userId, id, "name") };
}

export function tagIndexValue(dek: Buffer | null, userId: string, name: string): string {
  const normalized = tagNameKey(name);
  return dek ? tagBlindIndex(dek, userId, normalized) : normalized;
}

export function sealHighlight<T extends TextRecord>(
  dek: Buffer | null,
  userId: string,
  id: string,
  row: T,
): T {
  return sealFields(dek, row, "highlight", userId, id, HIGHLIGHT_TEXT_FIELDS);
}

export function openHighlight<T extends TextRecord>(dek: Buffer | null, userId: string, row: T): T {
  const id = stringField(row, "id");
  if (!id) return row;
  return openFields(dek, row, "highlight", userId, id, HIGHLIGHT_TEXT_FIELDS);
}

export function sealImportJob<T extends TextRecord>(dek: Buffer | null, userId: string, id: string, row: T): T {
  return sealFields(dek, row, "import", userId, id, IMPORT_TEXT_FIELDS);
}

export function openImportJob<T extends TextRecord>(dek: Buffer | null, row: T): T {
  const userId = stringField(row, "userId");
  const id = stringField(row, "id");
  if (!userId || !id) return row;
  return openFields(dek, row, "import", userId, id, IMPORT_TEXT_FIELDS);
}

function openNestedTagsAndHighlights<T extends TextRecord>(dek: Buffer | null, userId: string, row: T): T {
  const next: TextRecord = { ...row };
  if (Array.isArray(next.tags)) {
    next.tags = next.tags.map((link) => {
      if (!link || typeof link !== "object") return link;
      const tagged = link as { tag?: TextRecord };
      if (!tagged.tag) return link;
      return { ...tagged, tag: openTag(dek, { ...tagged.tag, userId }) };
    });
  }
  if (Array.isArray(next.suggestions)) {
    next.suggestions = next.suggestions.map((link) => {
      if (!link || typeof link !== "object") return link;
      const tagged = link as { tag?: TextRecord };
      if (!tagged.tag) return link;
      return { ...tagged, tag: openTag(dek, { ...tagged.tag, userId }) };
    });
  }
  if (Array.isArray(next.highlights)) {
    next.highlights = next.highlights.map((highlight) =>
      highlight && typeof highlight === "object"
        ? openHighlight(dek, userId, highlight as TextRecord)
        : highlight,
    );
  }
  return next as T;
}

function sealFields<T extends TextRecord>(
  dek: Buffer | null,
  row: T,
  kind: LibraryFieldKind,
  userId: string,
  id: string,
  fields: readonly string[],
): T {
  if (!dek) return row;
  const next: TextRecord = { ...row };
  for (const field of fields) {
    const value = next[field];
    if (typeof value === "string") {
      next[field] = sealString(dek, value, kind, userId, id, field);
    }
  }
  return next as T;
}

function openFields<T extends TextRecord>(
  dek: Buffer | null,
  row: T,
  kind: LibraryFieldKind,
  userId: string,
  id: string,
  fields: readonly string[],
): T {
  const next: TextRecord = { ...row };
  for (const field of fields) {
    const value = next[field];
    if (typeof value === "string") {
      next[field] = decryptText(dek, value, fieldAad(kind, userId, id, field));
    } else if (value === null) {
      next[field] = decryptOptional(dek, value, fieldAad(kind, userId, id, field));
    }
  }
  return next as T;
}

function stringField(row: TextRecord, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}
