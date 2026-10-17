/**
 * Helpers for mutating React Query infinite caches (cursor pages) without
 * full refetches — this is what keeps the UI snappy and lists stable.
 */
import type { QueryClient, InfiniteData } from "@tanstack/react-query";
import {
  DEFAULT_BOOKMARK_LIST_SORT,
  isBookmarkListSort,
  type BookmarkDetailDto,
  type BookmarkDto,
  type BookmarkReminderDto,
  type CursorPage,
  type FolderDto,
} from "@ordo/shared";
import { qk } from "./api/query-keys";
import { sortBookmarksBy } from "./list-sort";

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

/** Drop a created bookmark into the newest list; other orders refetch. */
export function insertCreatedBookmark(qc: QueryClient, bookmark: BookmarkDto) {
  const prefix = qk.bookmarks(bookmark.folderId);
  prependBookmarkToPages(qc, qk.bookmarks(bookmark.folderId, DEFAULT_BOOKMARK_LIST_SORT), bookmark);
  void qc.invalidateQueries({
    queryKey: prefix,
    predicate: (query) => query.queryKey[2] !== DEFAULT_BOOKMARK_LIST_SORT,
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
  insertBookmarksIfAbsent(qc, queryKey, [bookmark]);
}

export function insertBookmarksIfAbsent(qc: QueryClient, queryKey: readonly unknown[], bookmarks: readonly BookmarkDto[]) {
  qc.setQueriesData<BookmarkData>({ queryKey }, (data) => {
    if (!data?.pages[0]) return data;
    const present = new Set(data.pages.flatMap((page) => page.items.map((item) => item.id)));
    const missing = bookmarks.filter((bookmark) => !present.has(bookmark.id));
    if (!missing.length) return data;
    const firstPage = data.pages[0];
    return {
      ...data,
      pages: [{ ...firstPage, items: [...missing, ...firstPage.items] }, ...data.pages.slice(1)],
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
    typeof (data as { createdAt?: unknown }).createdAt === "string" &&
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
  let next = patch;
  const previous = old as T & { contentHtml?: string | null; highlights?: BookmarkDetailDto["highlights"] };
  if (!clearing && "contentHtml" in old && !("contentHtml" in patch)) {
    next = { ...next, contentHtml: previous.contentHtml } as T;
  }
  if ("highlights" in old && !("highlights" in patch)) {
    next = { ...next, highlights: previous.highlights } as T;
  }
  return next;
}

/** Apply the same list/detail patch to many bookmarks in one cache walk. */
export function updateBookmarksEverywhere(
  qc: QueryClient,
  ids: ReadonlySet<string>,
  updater: (b: BookmarkDto) => BookmarkDto,
) {
  if (ids.size === 0) return;
  qc.setQueriesData<unknown>({ queryKey: ["bookmarks"] }, (data: unknown) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return data;
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

/** Keep GET /bookmarks/reminders in lockstep with list/detail patches. */
export function syncReminderInCache(
  qc: QueryClient,
  bookmark: Pick<BookmarkDto, "id" | "folderId" | "title" | "remindAt"> &
    Partial<Pick<BookmarkDto, "domain" | "description">>,
) {
  syncRemindersInCache(qc, [bookmark]);
}

/** Reconcile a selection with one lookup/sort/publication, including Undo. */
export function syncRemindersInCache(qc: QueryClient, bookmarks: readonly (Pick<BookmarkDto, "id" | "folderId" | "title" | "remindAt"> &
  Partial<Pick<BookmarkDto, "domain" | "description">>)[]) {
  if (!bookmarks.length) return;
  qc.setQueryData<BookmarkReminderDto[]>(qk.reminders, (old) => {
    const rows = new Map((Array.isArray(old) ? old : []).map((row) => [row.id, row]));
    let changed = false;
    for (const bookmark of bookmarks) {
      if (bookmark.remindAt == null) { changed = rows.delete(bookmark.id) || changed; continue; }
      const existing = rows.get(bookmark.id);
      rows.set(bookmark.id, { id: bookmark.id, folderId: bookmark.folderId, title: bookmark.title || existing?.title || "",
        domain: bookmark.domain || existing?.domain || "", description: bookmark.description !== undefined ? bookmark.description : (existing?.description ?? null),
        remindAt: bookmark.remindAt });
      changed = true;
    }
    return changed ? [...rows.values()].sort((a, b) => a.remindAt - b.remindAt || a.id.localeCompare(b.id)) : old;
  });
}

export function removeRemindersFromCache(qc: QueryClient, ids: ReadonlySet<string>) {
  if (ids.size === 0) return;
  qc.setQueryData<BookmarkReminderDto[]>(qk.reminders, (old) => {
    if (!Array.isArray(old)) return old;
    const next = old.filter((row) => !ids.has(row.id));
    return next.length === old.length ? old : next;
  });
}

/** Copy extraction fields from a detail fetch onto list rows without shipping HTML. */
export function patchListsFromDetail(qc: QueryClient, detail: BookmarkDetailDto) {
  const { contentHtml: _html, highlights: _highlights, ...list } = detail;
  updateBookmarkEverywhere(qc, detail.id, (old) => {
    if ("contentHtml" in old) {
      return { ...old, ...detail };
    }
    return {
      ...old,
      ...list,
    };
  });
}

/** Remove many bookmarks from every cached list in one cache walk. */
export function removeBookmarksEverywhere(qc: QueryClient, ids: ReadonlySet<string>) {
  if (ids.size === 0) return;
  qc.setQueriesData<unknown>({ queryKey: ["bookmarks"] }, (data: unknown) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return data;
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
  const byId = new Map<string, { item: BookmarkDto; cachedAt: number }>();
  for (const query of qc.getQueryCache().getAll()) {
    const key = query.queryKey;
    if (!Array.isArray(key) || key[0] !== "bookmarks") continue;
    const data = query.state.data;
    const consider = (item: BookmarkDto) => {
      const previous = byId.get(item.id);
      if (!previous || (item.updatedAt ?? "") > (previous.item.updatedAt ?? "") ||
        (item.updatedAt === previous.item.updatedAt && query.state.dataUpdatedAt > previous.cachedAt))
        byId.set(item.id, { item, cachedAt: query.state.dataUpdatedAt });
    };
    if (isPagedBookmarks(data)) {
      for (const page of data.pages) {
        if (!page || !Array.isArray(page.items)) continue;
        for (const item of page.items) {
          if (isBookmarkRecord(item)) consider(item);
        }
      }
    } else if (isBookmarkRecord(data)) {
      consider(data);
    }
  }
  return [...byId.values()].map(({ item }) => item);
}

/** Move membership, not just a row in the currently visible list. Inactive
 * reader/search/index copies participate in deletes too, so they must agree. */
export function moveBookmarkInCache(qc: QueryClient, bookmark: BookmarkDto) {
  moveBookmarksInCache(qc, [bookmark]);
}

/** A batch move walks/sorts each cache once, not once per selected bookmark. */
export function moveBookmarksInCache(qc: QueryClient, bookmarks: readonly BookmarkDto[]) {
  if (!bookmarks.length) return;
  const moved = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  updateBookmarksEverywhere(qc, new Set(moved.keys()), (old) => ({ ...old, ...moved.get(old.id)! }));
  for (const query of qc.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    const key = query.queryKey;
    const data = query.state.data;
    if (!isPagedBookmarks(data)) continue;
    const folderList = key.length === 3 && isBookmarkListSort(key[2]);
    // Search keeps text/body matches, but must drop a row that left its scope.
    const folderIds = key[1] === "search" && Array.isArray(key[5]) ? key[5] as string[] : [];
    const unfiled = key[1] === "search" && key[6] === true;
    const scopedSearch = key[1] === "search" && (folderIds.length > 0 || unfiled);
    if (!folderList && !scopedSearch) continue;
    let changed = false;
    const pages = data.pages.map((page) => {
      const items = page.items.filter((item) => {
        const bookmark = moved.get(item.id);
        if (!bookmark) return true;
        const keep = folderList ? key[1] === bookmark.folderId
          : bookmark.folderId === null ? unfiled : folderIds.includes(bookmark.folderId);
        if (!keep) changed = true;
        return keep;
      });
      return items.length === page.items.length ? page : { ...page, items };
    });
    if (folderList && pages.length) {
      const present = new Set(pages.flatMap((page) => page.items.map((item) => item.id)));
      const incoming = [...moved.values()].filter((bookmark) => bookmark.folderId === key[1] && !present.has(bookmark.id));
      if (incoming.length) {
        changed = true;
        pages[0] = { ...pages[0]!, items: [...incoming, ...pages[0]!.items] };
      }
      // Existing destination rows may change sort fields even without insertion.
      if (changed || bookmarks.some((bookmark) => bookmark.folderId === key[1])) {
        const items = sortBookmarksBy(pages.flatMap((page) => page.items), key[2] as Parameters<typeof sortBookmarksBy>[1]);
        let offset = 0;
        qc.setQueryData<InfiniteData<CursorPage<BookmarkDto>>>(key, { ...data, pages: pages.map((page) => {
          const next = { ...page, items: items.slice(offset, offset + page.items.length) };
          offset += page.items.length;
          return next;
        }) });
        continue;
      }
    }
    if (changed) qc.setQueryData(key, { ...data, pages });
  }
  if (qc.getQueryData(qk.reminders) !== undefined) {
    qc.setQueryData<BookmarkReminderDto[]>(qk.reminders, (rows) => {
      const reminders = new Map((rows ?? []).map((row) => [row.id, row]));
      for (const bookmark of moved.values()) {
        if (bookmark.remindAt == null) reminders.delete(bookmark.id);
        else reminders.set(bookmark.id, { id: bookmark.id, folderId: bookmark.folderId, title: bookmark.title,
          domain: bookmark.domain, description: bookmark.description, remindAt: bookmark.remindAt });
      }
      return [...reminders.values()].sort((a, b) => a.remindAt - b.remindAt || a.id.localeCompare(b.id));
    });
  }
}

/** Aggregate folder deltas before publishing; large selections need one update. */
export function moveFolderCounts(qc: QueryClient, originals: readonly BookmarkDto[], destination: string | null, direction = 1) {
  const deltas = new Map<string, { total: number; unread: number }>();
  const add = (id: string | null, total: number, unread: number) => {
    if (!id) return;
    const previous = deltas.get(id) ?? { total: 0, unread: 0 };
    deltas.set(id, { total: previous.total + total, unread: previous.unread + unread });
  };
  for (const bookmark of originals) {
    if (bookmark.folderId === destination) continue;
    const unread = bookmark.isRead ? 0 : direction;
    add(bookmark.folderId, -direction, -unread);
    add(destination, direction, unread);
  }
  if (!deltas.size) return;
  qc.setQueryData<FolderDto[]>(qk.folders, (rows) => rows?.map((folder) => {
    const delta = deltas.get(folder.id);
    return delta ? { ...folder, bookmarkCount: Math.max(0, folder.bookmarkCount + delta.total),
      unreadCount: Math.max(0, folder.unreadCount + delta.unread) } : folder;
  }));
}

/** Undo only this move's membership/count deltas. Restoring entire query
 * snapshots would also roll back a different bookmark's concurrent move. */
export function rollbackBookmarkMoves(
  qc: QueryClient,
  originals: readonly BookmarkDto[],
  destination: string | null,
  snapshots: readonly [readonly unknown[], unknown][],
) {
  const current = new Map(collectCachedBookmarks(qc).map((bookmark) => [bookmark.id, bookmark]));
  const restored = new Map<string, BookmarkDto>();
  for (const original of originals) {
    const bookmark = { ...(current.get(original.id) ?? original), folderId: original.folderId };
    restored.set(bookmark.id, bookmark);
  }
  moveBookmarksInCache(qc, [...restored.values()]);
  moveFolderCounts(qc, originals, destination, -1);
  for (const [key, data] of snapshots) {
    if (!isPagedBookmarks(data)) continue;
    const missing = data.pages.flatMap((page) => page.items).flatMap((item) => restored.has(item.id) ? [restored.get(item.id)!] : []);
    if (missing.length) insertBookmarksIfAbsent(qc, key, missing);
  }
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
