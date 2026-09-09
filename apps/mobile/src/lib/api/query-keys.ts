/**
 * Centralised React Query key factory. Keeps cache keys stable & typed.
 */
import type { CursorPage } from "@ordo/shared";

export const qk = {
  me: ["auth", "me"] as const,
  sessions: ["auth", "sessions"] as const,
  serverInfo: (url?: string) => ["server", "info", url ?? null] as const,

  folders: ["folders"] as const,
  folder: (id: string) => ["folders", id] as const,
  importJob: (id: string) => ["import", id] as const,
  extractionProgress: ["bookmarks", "extraction-progress"] as const,

  /** `folderId` is null for the unfiled root list ("Bookmarks"). */
  bookmarks: (folderId: string | null) => ["bookmarks", folderId ?? null] as const,
  bookmark: (id: string) => ["bookmarks", "detail", id] as const,
  search: (q: string, tagIds: readonly string[] = [], unread?: "all" | "unread" | "read") =>
    ["bookmarks", "search", q, [...tagIds].sort(), unread ?? "all"] as const,

  /** Whole-library lists filtered by tags (sorted for key stability). */
  tagged: (tagIds: readonly string[]) => ["bookmarks", "tagged", [...tagIds].sort()] as const,

  /** Tag catalogue; keyed by folder-token visibility so unlocks refetch. */
  tags: (accessRevision: number) => ["tags", accessRevision] as const,
} as const;

export type PageParam = { cursor: string | null };

/** Invalidate every cached tag catalogue regardless of access revision. */
export const tagsAnyAccess = ["tags"] as const;

/** Flatten an infinite list of pages into a single items array. */
export function flattenPages<T>(pages: CursorPage<T>[]): T[] {
  return pages.flatMap((p) => p.items);
}
