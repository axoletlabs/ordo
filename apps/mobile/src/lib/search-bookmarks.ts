/**
 * Client-side search: sanitize route params, merge cached bookmarks with the
 * server result, and filter as you type with word-prefix matching.
 */
import { useEffect, useRef, useState } from "react";
import {
  bookmarkSearchRank,
  compareBookmarkSearchRanks,
  firstSearchHighlight as highlightSearchText,
  isPrimarySearchField,
  SEARCH_MATCH_QUALITY,
  tokenizeSearchQuery,
  tokensAllowArticleText,
  type BookmarkDto,
  type BookmarkSearchRank,
} from "@ordo/shared";

export type SearchStatusFilter = "all" | "unread" | "read";
export type SearchKindFilter = "all" | "article" | "web";

export interface SearchFilters {
  tagIds: string[];
  folderIds: string[];
  /** Include unfiled bookmarks when a folder filter is active. */
  unfiled: boolean;
  status: SearchStatusFilter;
  kind: SearchKindFilter;
  fuzzy: boolean;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  tagIds: [],
  folderIds: [],
  unfiled: false,
  status: "all",
  kind: "all",
  fuzzy: false,
};

/** Expo Router stringifies `undefined`, so empty params become the text "undefined". */
export function sanitizeRouteParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  if (raw === "undefined" || raw === "null") return "";
  return raw;
}

export function searchFiltersActive(filters: SearchFilters): boolean {
  return searchScopeActive(filters) || filters.fuzzy;
}

/** Filters that restrict which bookmarks can appear (fuzzy only changes matching). */
export function searchScopeActive(filters: SearchFilters): boolean {
  return (
    filters.tagIds.length > 0 ||
    filters.folderIds.length > 0 ||
    filters.unfiled ||
    filters.status !== "all" ||
    filters.kind !== "all"
  );
}

export function searchFiltersEqual(a: SearchFilters, b: SearchFilters): boolean {
  return (
    a.status === b.status &&
    a.kind === b.kind &&
    a.unfiled === b.unfiled &&
    a.fuzzy === b.fuzzy &&
    a.tagIds.length === b.tagIds.length &&
    a.folderIds.length === b.folderIds.length &&
    a.tagIds.every((id, index) => id === b.tagIds[index]) &&
    a.folderIds.every((id, index) => id === b.folderIds[index])
  );
}

/**
 * Commit a value after the current native press/layout has finished.
 * FlashList freezes when its data and a sibling layout change in the same
 * event (the search field already defers keystrokes for the same reason).
 */
export function useDeferredLayoutValue<T>(value: T, equal?: (a: T, b: T) => boolean): T {
  const [committed, setCommitted] = useState(value);
  const valueRef = useRef(value);
  const committedRef = useRef(committed);
  valueRef.current = value;
  committedRef.current = committed;
  const isEqual = equal ?? Object.is;
  useEffect(() => {
    if (isEqual(value, committedRef.current)) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setCommitted(valueRef.current);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [isEqual, value]);
  return committed;
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
  if (filters.folderIds.length > 0 || filters.unfiled) {
    const inFolder = bookmark.folderId
      ? filters.folderIds.includes(bookmark.folderId)
      : filters.unfiled;
    if (!inFolder) return false;
  }
  if (filters.status === "unread" && bookmark.isRead) return false;
  if (filters.status === "read" && !bookmark.isRead) return false;
  if (filters.kind === "article" && !isArticleBookmark(bookmark)) return false;
  if (filters.kind === "web" && isArticleBookmark(bookmark)) return false;
  return true;
}

const BODY_ONLY_RANK: BookmarkSearchRank = {
  matched: true,
  clause: "and",
  field: "body",
  quality: SEARCH_MATCH_QUALITY.prefix,
  hits: 1,
  usedFuzzy: false,
};

function rankFor(
  bookmark: BookmarkDto,
  query: string,
  filters: SearchFilters,
): BookmarkSearchRank {
  return bookmarkSearchRank(
    { ...bookmark, tags: namedTags(bookmark.tags) },
    query,
    { fuzzy: filters.fuzzy, omitTagIds: filters.tagIds },
  );
}

function passesTextQuery(
  bookmark: BookmarkDto,
  query: string,
  tokens: readonly string[],
  allowBodyOnlyHit: boolean,
  filters: SearchFilters,
): { ok: boolean; rank: BookmarkSearchRank } {
  if (tokens.length === 0) {
    return { ok: true, rank: { ...BODY_ONLY_RANK, field: "title", hits: 0, quality: 0 } };
  }
  const rank = rankFor(bookmark, query, filters);
  if (rank.matched) return { ok: true, rank };
  if (!allowBodyOnlyHit || !tokensAllowArticleText(tokens) || !isArticleBookmark(bookmark)) {
    return { ok: false, rank };
  }
  // Server rows that only matched the active tag's name are not article-body hits.
  if (filters.tagIds.length > 0) {
    const withTagNames = bookmarkSearchRank(
      { ...bookmark, tags: namedTags(bookmark.tags) },
      query,
      { fuzzy: filters.fuzzy, omitTagIds: [] },
    );
    if (withTagNames.matched && isPrimarySearchField(withTagNames.field)) {
      return { ok: false, rank };
    }
  }
  return { ok: true, rank: { ...BODY_ONLY_RANK, hits: tokens.length } };
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
  const byId = new Map<string, { bookmark: BookmarkDto; rank: BookmarkSearchRank }>();

  const consider = (bookmark: BookmarkDto, allowBodyOnlyHit: boolean) => {
    if (byId.has(bookmark.id)) return;
    if (!bookmarkPassesSearchFilters(bookmark, filters)) return;
    const { ok, rank } = passesTextQuery(bookmark, query, tokens, allowBodyOnlyHit, filters);
    if (!ok) return;
    byId.set(bookmark.id, { bookmark, rank });
  };

  for (const bookmark of serverItems) consider(bookmark, serverMatchesQuery);
  for (const bookmark of cachedItems) consider(bookmark, false);

  const merged = [...byId.values()];
  merged.sort((a, b) => {
    const byRank = compareBookmarkSearchRanks(a.rank, b.rank);
    if (byRank !== 0) return byRank;
    const byDate = (b.bookmark.createdAt ?? "").localeCompare(a.bookmark.createdAt ?? "");
    if (byDate !== 0) return byDate;
    return a.bookmark.id.localeCompare(b.bookmark.id);
  });
  return merged.map((row) => row.bookmark);
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

/** First matching word prefix of `query`'s first token, or null. */
export function firstSearchHighlight(
  text: string,
  query: string,
  fuzzy = false,
): { start: number; end: number } | null {
  return highlightSearchText(text, query, fuzzy);
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
