/**
 * Centralised React Query key factory. Keeps cache keys stable & typed.
 */
import type { BookmarkListSort } from "@ordo/shared";

export const qk = {
  me: ["auth", "me"] as const,
  sessions: ["auth", "sessions"] as const,
  serverInfo: (url?: string) => ["server", "info", url ?? null] as const,

  folders: ["folders"] as const,
  folder: (id: string) => ["folders", id] as const,
  importJob: (id: string) => ["import", id] as const,
  extractionProgress: ["bookmarks", "extraction-progress"] as const,

  /** `folderId` is null for the unfiled root list ("Bookmarks"). Omit `sort` to match every order. */
  bookmarks: (folderId: string | null, sort?: BookmarkListSort) =>
    sort
      ? (["bookmarks", folderId ?? null, sort] as const)
      : (["bookmarks", folderId ?? null] as const),
  bookmark: (id: string) => ["bookmarks", "detail", id] as const,
  search: (
    q: string,
    tagIds: readonly string[] = [],
    unread?: "all" | "unread" | "read",
    folderIds: readonly string[] = [],
    unfiled = false,
    fuzzy = false,
    reminder: "all" | "due" | "upcoming" = "all",
  ) =>
    [
      "bookmarks",
      "search",
      q,
      [...tagIds].sort(),
      unread ?? "all",
      [...folderIds].sort(),
      unfiled,
      fuzzy,
      reminder,
    ] as const,

  reminders: ["bookmarks", "reminders"] as const,

  /** Whole-library lists filtered by tags (sorted for key stability). */
  tagged: (tagIds: readonly string[]) => ["bookmarks", "tagged", [...tagIds].sort()] as const,

  /** Tag catalogue; keyed by folder-token visibility so unlocks refetch. */
  tags: (accessRevision: number) => ["tags", accessRevision] as const,
} as const;

export type PageParam = { cursor: string | null };

/** Invalidate every cached tag catalogue regardless of access revision. */
export const tagsAnyAccess = ["tags"] as const;

function itemId(item: unknown): string | undefined {
  if (item == null || typeof item !== "object" || !("id" in item)) return undefined;
  const id = (item as { id: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Flatten cursor pages, keeping the first copy of each id.
 *
 * A retried first page (null cursor treated as a next page) concatenates the
 * same items twice. Sorting that array groups copies as A,A,B,B — FlashList
 * recycled by key so those copies were empty 200px slots; FlatList paints them.
 */
export function flattenPages<T>(pages: readonly { items: readonly T[] }[]): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const id = itemId(item);
      if (id != null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      items.push(item);
    }
  }
  return items;
}

/** `undefined` means stop — a null cursor would refetch page one and duplicate rows. */
export function nextPageCursor(page: {
  hasMore: boolean;
  nextCursor: string | null | undefined;
}): string | undefined {
  return page.hasMore && page.nextCursor ? page.nextCursor : undefined;
}
