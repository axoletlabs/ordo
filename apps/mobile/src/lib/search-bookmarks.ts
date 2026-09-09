/**
 * Client-side search: sanitize route params, merge cached bookmarks with the
 * server result, and rank as you type so the list can reorder immediately.
 */
import { useEffect, useState } from "react";
import {
  bookmarkMatchesQuery,
  rankSearchResults,
  type BookmarkDto,
} from "@ordo/shared";

export type SearchStatusFilter = "all" | "unread" | "read";
export type SearchKindFilter = "all" | "article" | "web";

export interface SearchFilters {
  tagIds: string[];
  status: SearchStatusFilter;
  kind: SearchKindFilter;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  tagIds: [],
  status: "all",
  kind: "all",
};

/** Expo Router stringifies `undefined`, so empty params become the text "undefined". */
export function sanitizeRouteParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  if (raw === "undefined" || raw === "null") return "";
  return raw;
}

export function searchFiltersActive(filters: SearchFilters): boolean {
  return filters.tagIds.length > 0 || filters.status !== "all" || filters.kind !== "all";
}

function isArticleBookmark(bookmark: BookmarkDto): boolean {
  if (bookmark.contentKind === "article") return true;
  if (bookmark.contentKind === "web" || bookmark.contentKind === "media" || bookmark.contentKind === "file") {
    return false;
  }
  return bookmark.fetchStatus === "ok";
}

export function bookmarkPassesSearchFilters(bookmark: BookmarkDto, filters: SearchFilters): boolean {
  if (filters.tagIds.some((id) => !bookmark.tags.some((tag) => tag.id === id))) return false;
  if (filters.status === "unread" && bookmark.isRead) return false;
  if (filters.status === "read" && !bookmark.isRead) return false;
  if (filters.kind === "article" && !isArticleBookmark(bookmark)) return false;
  if (filters.kind === "web" && isArticleBookmark(bookmark)) return false;
  return true;
}

export function compileSearchResults({
  query,
  filters,
  serverItems,
  cachedItems,
  serverMatchesQuery,
}: {
  query: string;
  filters: SearchFilters;
  serverItems: readonly BookmarkDto[];
  cachedItems: readonly BookmarkDto[];
  /** True when `serverItems` were fetched for this exact query string. */
  serverMatchesQuery: boolean;
}): BookmarkDto[] {
  const q = query.trim();
  const byId = new Map<string, BookmarkDto>();

  for (const bookmark of serverItems) {
    if (!serverMatchesQuery && q && !bookmarkMatchesQuery(bookmark, q)) continue;
    byId.set(bookmark.id, bookmark);
  }

  for (const bookmark of cachedItems) {
    if (byId.has(bookmark.id)) continue;
    if (q && !bookmarkMatchesQuery(bookmark, q)) continue;
    byId.set(bookmark.id, bookmark);
  }

  const merged = [...byId.values()].filter((bookmark) => bookmarkPassesSearchFilters(bookmark, filters));
  return rankSearchResults(merged, q);
}

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [delay, value]);
  return debounced;
}
