/**
 * Client-side search: sanitize route params, merge cached bookmarks with the
 * server result, and filter as you type with literal substring matching.
 */
import { useEffect, useState } from "react";
import {
  bookmarkMatchRank,
  bookmarkSearchHaystack,
  tokenizeSearchQuery,
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

function namedTags(tags: BookmarkDto["tags"] | unknown): { id?: string; name: string }[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is { id?: string; name: string } => !!tag && typeof tag.name === "string");
}

export function bookmarkPassesSearchFilters(bookmark: BookmarkDto, filters: SearchFilters): boolean {
  const tags = namedTags(bookmark.tags);
  if (filters.tagIds.some((id) => !tags.some((tag) => tag.id === id))) return false;
  if (filters.status === "unread" && bookmark.isRead) return false;
  if (filters.status === "read" && !bookmark.isRead) return false;
  if (filters.kind === "article" && !isArticleBookmark(bookmark)) return false;
  if (filters.kind === "web" && isArticleBookmark(bookmark)) return false;
  return true;
}

const haystackMemo = new Map<string, { stamp: string; haystack: string }>();

function haystackStamp(bookmark: BookmarkDto): string {
  const tagNames = namedTags(bookmark.tags)
    .map((tag) => tag.name)
    .join("\0");
  return `${bookmark.updatedAt ?? ""}\0${bookmark.title ?? ""}\0${bookmark.url ?? ""}\0${bookmark.domain ?? ""}\0${bookmark.description ?? ""}\0${bookmark.author ?? ""}\0${tagNames}`;
}

/** Cached haystack so typing does not rebuild lowercase blobs on every key. */
function haystackFor(bookmark: BookmarkDto): string {
  const stamp = haystackStamp(bookmark);
  const hit = haystackMemo.get(bookmark.id);
  if (hit && hit.stamp === stamp) return hit.haystack;
  const haystack = bookmarkSearchHaystack({
    ...bookmark,
    tags: namedTags(bookmark.tags),
  });
  if (haystackMemo.size > 4000) haystackMemo.clear();
  haystackMemo.set(bookmark.id, { stamp, haystack });
  return haystack;
}

function haystackMatches(haystack: string, tokens: readonly string[]): boolean {
  return tokens.every((token) => haystack.includes(token));
}

function passesTextQuery(
  bookmark: BookmarkDto,
  tokens: readonly string[],
  allowBodyOnlyHit: boolean,
): boolean {
  if (tokens.length === 0) return true;
  if (haystackMatches(haystackFor(bookmark), tokens)) return true;
  // List payloads omit article bodies. Keep a row the server already matched
  // for this exact query (title/url/tag did not, but the article did).
  return allowBodyOnlyHit;
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
  const tokens = tokenizeSearchQuery(query);
  const byId = new Map<string, BookmarkDto>();

  for (const bookmark of serverItems) {
    if (!passesTextQuery(bookmark, tokens, serverMatchesQuery)) continue;
    if (!bookmarkPassesSearchFilters(bookmark, filters)) continue;
    byId.set(bookmark.id, bookmark);
  }

  for (const bookmark of cachedItems) {
    if (byId.has(bookmark.id)) continue;
    if (!passesTextQuery(bookmark, tokens, false)) continue;
    if (!bookmarkPassesSearchFilters(bookmark, filters)) continue;
    byId.set(bookmark.id, bookmark);
  }

  const merged = [...byId.values()];
  const q = tokens.join(" ");
  if (!q) {
    return merged.sort(
      (a, b) =>
        (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.id.localeCompare(b.id),
    );
  }

  const ranked = merged.map((bookmark) => ({
    bookmark,
    rank: bookmarkMatchRank(bookmark, q),
  }));
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    const byDate = (b.bookmark.createdAt ?? "").localeCompare(a.bookmark.createdAt ?? "");
    if (byDate !== 0) return byDate;
    return a.bookmark.id.localeCompare(b.bookmark.id);
  });
  return ranked.map((row) => row.bookmark);
}

/** Keep the previous array when the visible order did not change, so the list can skip work. */
export function reuseSearchResults(
  previous: readonly BookmarkDto[],
  next: BookmarkDto[],
): BookmarkDto[] {
  if (previous.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    const a = previous[i]!;
    const b = next[i]!;
    if (a.id !== b.id || a.updatedAt !== b.updatedAt || a.isRead !== b.isRead) return next;
  }
  return previous as BookmarkDto[];
}

/** First case-insensitive substring of `query`'s first token, or null. */
export function firstSearchHighlight(text: string, query: string): { start: number; end: number } | null {
  const token = tokenizeSearchQuery(query)[0];
  if (!token || !text) return null;
  const at = text.toLocaleLowerCase("en-US").indexOf(token);
  if (at < 0) return null;
  return { start: at, end: at + token.length };
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
