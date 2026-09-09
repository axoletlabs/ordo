/**
 * Helpers for mutating React Query infinite caches (cursor pages) without
 * full refetches — this is what keeps the UI snappy and lists stable.
 */
import type { QueryClient, InfiniteData } from "@tanstack/react-query";
import type { BookmarkDetailDto, BookmarkDto, CursorPage, FolderDto } from "@ordo/shared";
import { qk } from "./api/query-keys";

type BookmarkData = InfiniteData<CursorPage<BookmarkDto>, string | null>;

export function updateBookmarkInPages(
  qc: QueryClient,
  queryKey: readonly unknown[],
  id: string,
  updater: (b: BookmarkDto) => BookmarkDto,
) {
  qc.setQueriesData<InfiniteData<CursorPage<BookmarkDto>>>({ queryKey }, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((b) => (b.id === id ? updater(b) : b)),
      })),
    };
  });
}

export function removeBookmarkFromPages(
  qc: QueryClient,
  queryKey: readonly unknown[],
  id: string,
) {
  qc.setQueriesData<InfiniteData<CursorPage<BookmarkDto>>>({ queryKey }, (data) => {
    if (!data) return data;
    let totalRemoved = 0;
    const pages = data.pages.map((page) => {
      const items = page.items.filter((b) => {
        if (b.id === id) {
          totalRemoved += 1;
          return false;
        }
        return true;
      });
      return { ...page, items };
    });
    if (totalRemoved === 0) return data;
    return { ...data, pages };
  });
}

/** Prepend a newly-created bookmark to the first page of an infinite list. */
export function prependBookmarkToPages(
  qc: QueryClient,
  queryKey: readonly unknown[],
  bookmark: BookmarkDto,
) {
  qc.setQueriesData<BookmarkData>({ queryKey }, (data) => {
    if (!data?.pages[0]) return data;
    const firstPage = data.pages[0];
    const updatedFirst: CursorPage<BookmarkDto> = {
      ...firstPage,
      items: [bookmark, ...firstPage.items],
    };
    return { ...data, pages: [updatedFirst, ...data.pages.slice(1)] };
  });
}

/** Prepend a bookmark unless it is already in the list (used to restore after undo). */
export function insertBookmarkIfAbsent(
  qc: QueryClient,
  queryKey: readonly unknown[],
  bookmark: BookmarkDto,
) {
  qc.setQueriesData<BookmarkData>({ queryKey }, (data) => {
    if (!data?.pages[0]) return data;
    if (data.pages.some((page) => page.items.some((item) => item.id === bookmark.id))) return data;
    const firstPage = data.pages[0];
    return {
      ...data,
      pages: [{ ...firstPage, items: [bookmark, ...firstPage.items] }, ...data.pages.slice(1)],
    };
  });
}

/** Adjust a folder's cached bookmark/unread counts. No-op for unfiled (null). */
export function bumpFolderCount(
  qc: QueryClient,
  id: string | null,
  bookmarkDelta: number,
  unreadDelta: number,
) {
  if (!id) return;
  qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
    (old ?? []).map((folder) =>
      folder.id === id
        ? {
            ...folder,
            bookmarkCount: Math.max(0, folder.bookmarkCount + bookmarkDelta),
            unreadCount: Math.max(0, folder.unreadCount + unreadDelta),
          }
        : folder,
    ),
  );
}

/** Re-key helper: all bookmark list caches for any folder (for global effects). */
export function allBookmarkListMatcher() {
  return { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === "bookmarks" && q.queryKey[1] !== "search" };
}

function isPagedBookmarks(
  data: unknown,
): data is InfiniteData<CursorPage<BookmarkDto>> {
  return !!data && typeof data === "object" && Array.isArray((data as { pages?: unknown }).pages);
}

function isBookmarkRecord(data: unknown): data is BookmarkDto {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as { id?: unknown }).id === "string" &&
    Array.isArray((data as { tags?: unknown }).tags)
  );
}

/**
 * Map every cached bookmark (infinite lists + reader detail). Leave other
 * `bookmarks`-prefixed payloads alone — extraction progress is `{ pending }`,
 * not a paged list, and calling `.pages.map` on it throws.
 */
export function mapCachedBookmarks(
  qc: QueryClient,
  mapper: (b: BookmarkDto) => BookmarkDto,
) {
  qc.setQueriesData<unknown>({ queryKey: ["bookmarks"] }, (data: unknown) => {
    if (isPagedBookmarks(data)) {
      let changed = false;
      const pages = data.pages.map((page) => {
        if (!page || !Array.isArray(page.items)) return page;
        let pageChanged = false;
        const items = page.items.map((b) => {
          const next = mapper(b);
          if (next !== b) pageChanged = true;
          return next;
        });
        if (!pageChanged) return page;
        changed = true;
        return { ...page, items };
      });
      return changed ? { ...data, pages } : data;
    }
    if (isBookmarkRecord(data)) {
      const next = mapper(data);
      return next === data ? data : next;
    }
    return data;
  });
}

/**
 * Update a bookmark everywhere it is cached: every list (folders + search)
 * plus the detail entry (which additionally carries contentHtml). Queries
 * not containing this bookmark are returned unchanged.
 *
 * List payloads omit article bodies; do not clobber a cached detail/list
 * body with those nulls unless the patch is actually clearing content.
 */
export function updateBookmarkEverywhere(
  qc: QueryClient,
  id: string,
  updater: (b: BookmarkDto) => BookmarkDto,
) {
  updateBookmarksEverywhere(qc, new Set([id]), updater);
}

function preserveBodies<T extends BookmarkDto>(old: T, patch: T): T {
  const clearing =
    patch.fetchStatus === "unsupported" ||
    patch.fetchStatus === "failed" ||
    patch.contentKindOverride === "web";
  if (clearing) return patch;
  return {
    ...patch,
    contentText: patch.contentText ?? old.contentText,
    contentMarkdown: patch.contentMarkdown ?? old.contentMarkdown,
  };
}

/** Apply the same list/detail patch to many bookmarks in one cache walk. */
export function updateBookmarksEverywhere(
  qc: QueryClient,
  ids: ReadonlySet<string>,
  updater: (b: BookmarkDto) => BookmarkDto,
) {
  if (ids.size === 0) return;
  qc.setQueriesData<unknown>({ queryKey: ["bookmarks"] }, (data: unknown) => {
    if (!data || typeof data !== "object") return data;
    if (Array.isArray((data as { pages?: unknown }).pages)) {
      const paged = data as InfiniteData<CursorPage<BookmarkDto>>;
      let changed = false;
      const pages = paged.pages.map((page) => {
        let pageChanged = false;
        const items = page.items.map((b) => {
          if (!ids.has(b.id)) return b;
          pageChanged = true;
          return preserveBodies(b, updater(b) as BookmarkDto);
        });
        if (!pageChanged) return page;
        changed = true;
        return { ...page, items };
      });
      return changed ? { ...paged, pages } : data;
    }
    const detail = data as BookmarkDetailDto;
    if (!ids.has(detail.id)) return data;
    const next = updater(detail) as BookmarkDetailDto;
    return preserveBodies(detail, next);
  });
}

/** Copy extraction fields from a detail fetch onto list rows without shipping HTML. */
export function patchListsFromDetail(qc: QueryClient, detail: BookmarkDetailDto) {
  const { contentHtml: _html, contentText: _text, contentMarkdown: _md, ...list } = detail;
  updateBookmarkEverywhere(qc, detail.id, (old) => {
    if ("contentHtml" in old) {
      return { ...old, ...detail };
    }
    return {
      ...old,
      ...list,
      contentText: null,
      contentMarkdown: null,
    };
  });
}

/** Remove many bookmarks from every cached list in one cache walk. */
export function removeBookmarksEverywhere(qc: QueryClient, ids: ReadonlySet<string>) {
  if (ids.size === 0) return;
  qc.setQueriesData<unknown>({ queryKey: ["bookmarks"] }, (data: unknown) => {
    if (!data || typeof data !== "object") return data;
    if (!Array.isArray((data as { pages?: unknown }).pages)) return data;
    const paged = data as InfiniteData<CursorPage<BookmarkDto>>;
    let changed = false;
    const pages = paged.pages.map((page) => {
      const items = page.items.filter((b) => {
        if (!ids.has(b.id)) return true;
        changed = true;
        return false;
      });
      return items.length === page.items.length ? page : { ...page, items };
    });
    return changed ? { ...paged, pages } : data;
  });
}

/** Every bookmark currently in the React Query cache (lists + reader detail). */
export function collectCachedBookmarks(qc: QueryClient): BookmarkDto[] {
  const byId = new Map<string, BookmarkDto>();
  for (const query of qc.getQueryCache().getAll()) {
    const data = query.state.data;
    if (isPagedBookmarks(data)) {
      for (const page of data.pages) {
        if (!page || !Array.isArray(page.items)) continue;
        for (const item of page.items) {
          if (item?.id) byId.set(item.id, item);
        }
      }
    } else if (isBookmarkRecord(data)) {
      byId.set(data.id, data);
    }
  }
  return [...byId.values()];
}

/**
 * Find a bookmark across all cached bookmark lists (folder lists + search).
 * Lets the reader render instantly from cache without a detail fetch.
 */
export function findBookmarkInCache(qc: QueryClient, id: string): BookmarkDto | undefined {
  const caches = qc.getQueriesData<InfiniteData<CursorPage<BookmarkDto>>>({
    queryKey: ["bookmarks"],
  });
  for (const [, data] of caches) {
    // The prefix also matches bookmark detail queries, which are not paginated.
    if (!data || !Array.isArray(data.pages)) continue;
    for (const page of data.pages) {
      const found = page.items.find((b) => b.id === id);
      if (found) return found;
    }
  }
  return undefined;
}
