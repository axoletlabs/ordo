/** Cursor-based pagination helpers. A date cursor encodes `(createdAt, id)` so we
 *  can paginate deterministically even for items that share a timestamp. Title
 *  cursors encode `(id, title)` with a prefix so they cannot be mistaken for dates. */
export interface Cursor {
  createdAt: string; // ISO string
  id: string;
}

export interface TitleCursor {
  title: string;
  id: string;
}

const TITLE_CURSOR_PREFIX = "t|";

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    if (decoded.startsWith(TITLE_CURSOR_PREFIX)) return null;
    const sep = decoded.lastIndexOf("|");
    if (sep <= 0) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!createdAt || !id) return null;
    const ms = Date.parse(createdAt);
    if (Number.isNaN(ms)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function encodeTitleCursor(c: TitleCursor): string {
  return Buffer.from(`${TITLE_CURSOR_PREFIX}${c.id}|${c.title}`, "utf8").toString("base64url");
}

export function decodeTitleCursor(raw: string | null | undefined): TitleCursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    if (!decoded.startsWith(TITLE_CURSOR_PREFIX)) return null;
    const rest = decoded.slice(TITLE_CURSOR_PREFIX.length);
    const sep = rest.indexOf("|");
    if (sep <= 0) return null;
    const id = rest.slice(0, sep);
    const title = rest.slice(sep + 1);
    if (!id) return null;
    return { title, id };
  } catch {
    return null;
  }
}

export interface PageMeta {
  limit: number;
  cursor: Cursor | null;
}

/** Clamp a requested page size to allowed bounds. */
export function clampLimit(value: unknown, def: number, max: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : typeof value === "number" ? value : def;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}
