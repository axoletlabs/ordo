/**
 * Bookmark queries + mutations. Optimistic updates keep the UI instant;
 * background refetch reconciles with the server.
 */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { bookmarksApi } from "../lib/api/bookmarks";
import { queryClient } from "../lib/query-client";
import { useFolderTokenStore } from "../store/folder-tokens";
import { useListSortStore } from "../store/list-sort";
import { nextPageCursor, qk } from "../lib/api/query-keys";
import {
  bumpFolderCount,
  collectCachedBookmarks,
  insertCreatedBookmark,
  moveBookmarkInCache,
  moveBookmarksInCache,
  moveFolderCounts,
  patchListsFromDetail,
  removeBookmarksEverywhere,
  rollbackBookmarkMoves,
  syncReminderInCache,
  updateBookmarkEverywhere,
  updateBookmarkInPages,
  updateBookmarksEverywhere,
} from "../lib/cache-helpers";
import { deleteBookmarksUndoable } from "../lib/undoable-delete";
import {
  BATCH_ITEM_LIMIT,
  DEFAULT_BOOKMARK_LIST_SORT,
  extractionPollIntervalMs,
  type BookmarkDetailDto,
  type BookmarkDto,
  type FolderDto,
  type HighlightDto,
} from "@ordo/shared";
import { LIST_PAGE_SIZE } from "../lib/list-pagination";
import { PERSISTED_QUERY_GC_TIME_MS } from "../lib/query-persist";

const BOOKMARK_WRITE_KEY = ["bookmarks", "write"] as const;

function snapshotLists(qc: QueryClient, folderId: string | null) {
  return qc.getQueriesData({ queryKey: qk.bookmarks(folderId) });
}

function restoreLists(qc: QueryClient, snapshots: ReturnType<typeof snapshotLists> | undefined) {
  if (!snapshots) return;
  for (const [key, data] of snapshots) qc.setQueryData(key, data);
}

export function prefetchFolderBookmarks(folderId: string) {
  const sort = useListSortStore.getState().bookmarkSort(folderId);
  return queryClient.prefetchInfiniteQuery({
    queryKey: qk.bookmarks(folderId, sort),
    queryFn: ({ pageParam, signal }) =>
      bookmarksApi.list({ folderId, cursor: pageParam ?? undefined, limit: LIST_PAGE_SIZE, sort, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    gcTime: PERSISTED_QUERY_GC_TIME_MS,
  });
}

/** Article HTML is stable once extracted; pending or forced articles stay live. */
function detailStaleTime(query: { state: { data?: BookmarkDetailDto } }): number {
  const data = query.state.data;
  return data?.fetchStatus === "pending" || (data?.contentKindOverride === "article" && data.fetchStatus !== "ok")
    ? 0
    : 5 * 60_000;
}

export function prefetchBookmarkDetail(id: string, folderId?: string | null) {
  if (!id) return;
  return queryClient.prefetchQuery({
    queryKey: qk.bookmark(id),
    queryFn: async ({ signal }) => {
      const detail = await bookmarksApi.detail(id, folderId, signal);
      // React Native's abort-controller polyfill has no throwIfAborted().
      if (signal.aborted) throw new Error("Bookmark request was cancelled.");
      patchListsFromDetail(queryClient, detail);
      return detail;
    },
    // Same freshness as the reader, or a press-in re-downloads article HTML
    // the reader would reuse.
    staleTime: detailStaleTime,
  });
}

export function useInfiniteBookmarks(folderId: string | null, enabled = true) {
  const sort = useListSortStore((state) =>
    folderId ? (state.folderBookmarkSorts[folderId] ?? DEFAULT_BOOKMARK_LIST_SORT) : state.unfiledSort,
  );
  return useInfiniteQuery({
    queryKey: qk.bookmarks(folderId, sort),
    queryFn: ({ pageParam, signal }) =>
      bookmarksApi.list({ folderId, cursor: pageParam ?? undefined, limit: LIST_PAGE_SIZE, sort, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    placeholderData: keepPreviousData,
    gcTime: PERSISTED_QUERY_GC_TIME_MS,
    enabled,
  });
}

export function useInfiniteSearch(
  q: string,
  opts: {
    tagIds?: readonly string[];
    folderIds?: readonly string[];
    unfiled?: boolean;
    unread?: "all" | "unread" | "read";
    fuzzy?: boolean;
    reminder?: "all" | "due" | "upcoming";
    enabled?: boolean;
  } = {},
) {
  const term = q.trim();
  const tagIds = opts.tagIds ?? [];
  const folderIds = opts.folderIds ?? [];
  const unfiled = opts.unfiled ?? false;
  const unread = opts.unread ?? "all";
  const fuzzy = opts.fuzzy ?? false;
  const reminder = opts.reminder ?? "all";
  const enabled = opts.enabled ?? true;
  return useInfiniteQuery({
    queryKey: qk.search(term, tagIds, unread, folderIds, unfiled, fuzzy, reminder),
    queryFn: ({ pageParam, signal }) =>
      bookmarksApi.search(
        term,
        pageParam ?? undefined,
        LIST_PAGE_SIZE,
        [...tagIds],
        unread,
        [...folderIds],
        unfiled,
        fuzzy,
        reminder,
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    enabled,
  });
}

export function useBookmarkDetail(id: string, enabled = true, folderId?: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.bookmark(id),
    queryFn: async ({ signal }) => {
      const detail = await bookmarksApi.detail(id, folderId, signal);
      if (signal.aborted) throw new Error("Bookmark request was cancelled.");
      patchListsFromDetail(qc, detail);
      return detail;
    },
    enabled: !!id && enabled,
    staleTime: detailStaleTime,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      // Boot re-extracts keep `failed` until they finish; keep polling so an
      // open reader picks up HTML without leaving the screen.
      if (data.fetchStatus === "pending") {
        return extractionPollIntervalMs(query.state.dataUpdateCount);
      }
      if (data.contentKindOverride === "article" && data.fetchStatus !== "ok") {
        return extractionPollIntervalMs(query.state.dataUpdateCount);
      }
      return false;
    },
  });
}

export function useCreateBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ url, folderId, tagIds = [] }: { url: string; folderId: string | null; tagIds?: string[] }) =>
      bookmarksApi.create(url, folderId, tagIds),
    onSuccess: (bookmark) => {
      insertCreatedBookmark(qc, bookmark);
      bumpFolderCount(qc, bookmark.folderId, +1, bookmark.isRead ? 0 : +1);
      // The progress query stops polling at zero; a new save must wake it up.
      void qc.invalidateQueries({ queryKey: qk.extractionProgress });
      if (bookmark.tags.length > 0) {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }
    },
  });
}

export function useToggleRead(folderId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      bookmarksApi.update(id, { isRead }, { folderId }),
    onMutate: ({ id, isRead }) => {
      const prev = snapshotLists(qc, folderId);
      const prevFolders = qc.getQueryData<FolderDto[]>(qk.folders);
      updateBookmarkInPages(qc, qk.bookmarks(folderId), id, (b) => ({ ...b, isRead }));
      bumpFolderCount(qc, folderId, 0, isRead ? -1 : +1);
      return { prev, prevFolders };
    },
    onError: (_e, _v, ctx) => {
      restoreLists(qc, ctx?.prev);
      if (ctx?.prevFolders) qc.setQueryData(qk.folders, ctx.prevFolders);
    },
    onSuccess: (updated) => {
      // Reconcile every other view (tag lists, search, detail) with the server.
      updateBookmarkEverywhere(qc, updated.id, (bookmark) => ({ ...bookmark, ...updated }));
    },
  });
}

/** Force a bookmark to open as an article or a website, or clear the override. */
export function useSetContentKind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      folderId,
      contentKindOverride,
    }: {
      id: string;
      folderId: string | null;
      contentKindOverride: "article" | "web";
    }) => bookmarksApi.setContentKind(id, contentKindOverride, { folderId }),
    onMutate: ({ id, contentKindOverride }) => {
      updateBookmarkEverywhere(qc, id, (bookmark) => {
        if (contentKindOverride === "article") {
          return {
            ...bookmark,
            contentKindOverride: "article",
            contentKind: "article",
            fetchStatus: bookmark.fetchStatus === "ok" ? "ok" : "pending",
          };
        }
        // Forced extracts snapshot the website row; drop the article capture locally
        // until the server restore arrives.
        const restoringForcedArticle =
          bookmark.contentKindOverride === "article" || bookmark.fetchStatus === "pending";
        if (restoringForcedArticle) {
          return {
            ...bookmark,
            contentKindOverride: null,
            contentKind: "web",
            fetchStatus: "unsupported",
            extractionReason: bookmark.extractionReason ?? "not_an_article",
            readingTimeMinutes: null,
            ...("contentHtml" in bookmark ? { contentHtml: null } : {}),
          };
        }
        return {
          ...bookmark,
          contentKindOverride: "web",
          contentKind: "web",
        };
      });
    },
    onSuccess: (updated) => {
      updateBookmarkEverywhere(qc, updated.id, (bookmark) => ({
        ...bookmark,
        ...updated,
        ...("contentHtml" in bookmark && updated.fetchStatus !== "ok" ? { contentHtml: null } : {}),
      }));
      void qc.invalidateQueries({ queryKey: qk.bookmark(updated.id) });
      void qc.invalidateQueries({ queryKey: qk.extractionProgress });
    },
    onError: (_e, { id }) => {
      // The optimistic override was never persisted; refetch the truth. The
      // prefix key also heals the detail query.
      void qc.invalidateQueries({ queryKey: qk.bookmark(id) });
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });
}

export function useSetBookmarkReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      folderId,
      remindAt,
    }: {
      id: string;
      folderId: string | null;
      title: string;
      domain?: string;
      description?: string | null;
      remindAt: number | null;
    }) => bookmarksApi.update(id, { remindAt }, { folderId }),
    onMutate: ({ id, folderId, title, domain, description, remindAt }) => {
      updateBookmarkEverywhere(qc, id, (bookmark) => ({ ...bookmark, remindAt }));
      syncReminderInCache(qc, { id, folderId, title, domain, description, remindAt });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
    },
    onSuccess: (updated) => {
      updateBookmarkEverywhere(qc, updated.id, (bookmark) => ({ ...bookmark, ...updated }));
      syncReminderInCache(qc, updated);
      void import("../lib/reminder-notifications").then(({ syncBookmarkReminder }) =>
        syncBookmarkReminder(updated),
      );
      void qc.invalidateQueries({ queryKey: qk.reminders });
    },
  });
}

export function useDeleteBookmark(folderId: string | null) {
  return {
    mutate: (bookmark: BookmarkDto, opts?: { onDeleted?: () => void }) =>
      deleteBookmarksUndoable([bookmark], {
        scopeFolderId: folderId,
        onDeleted: opts?.onDeleted,
      }),
  };
}

export function useMoveBookmark(fromFolderId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: BOOKMARK_WRITE_KEY,
    mutationFn: ({ id, toFolderId }: { id: string; toFolderId: string | null }) =>
      bookmarksApi.update(id, { folderId: toFolderId }, {
        folderId:
          toFolderId && useFolderTokenStore.getState().get(toFolderId)
            ? toFolderId
            : fromFolderId,
      }),
    onMutate: async ({ id, toFolderId }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["bookmarks"] }),
        qc.cancelQueries({ queryKey: qk.folders }),
      ]);
      const snapshots = qc.getQueriesData({ queryKey: ["bookmarks"] });
      const target = collectCachedBookmarks(qc).find((bookmark) => bookmark.id === id);
      if (target) {
        moveBookmarkInCache(qc, { ...target, folderId: toFolderId });
        if (target.folderId !== toFolderId) {
          bumpFolderCount(qc, target.folderId, -1, target.isRead ? 0 : -1);
          bumpFolderCount(qc, toFolderId, +1, target.isRead ? 0 : +1);
        }
      }
      return { snapshots, originals: target ? [target] : [] };
    },
    onError: async (_e, { toFolderId }, ctx) => {
      await qc.cancelQueries({ queryKey: ["bookmarks"] });
      if (ctx) rollbackBookmarkMoves(qc, ctx.originals, toFolderId, ctx.snapshots);
    },
    onSuccess: async (updated) => {
      // Navigation/prefetch can start another read during the mutation.
      await qc.cancelQueries({ queryKey: ["bookmarks"] });
      moveBookmarkInCache(qc, updated);
    },
    onSettled: () => {
      // A different move may still be optimistic. Refetch only after the last
      // write, otherwise its pre-commit server row can overwrite that move.
      if (qc.isMutating({ mutationKey: BOOKMARK_WRITE_KEY }) > 1) return;
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
      void qc.invalidateQueries({ queryKey: qk.folders });
    },
  });
}

export function useMarkAllRead(folderId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bookmarksApi.markAllRead(folderId),
    onMutate: () => {
      const prev = snapshotLists(qc, folderId);
      const prevFolders = qc.getQueryData<FolderDto[]>(qk.folders);
      qc.setQueriesData<{ pages: { items: BookmarkDto[] }[] }>(
        { queryKey: qk.bookmarks(folderId) },
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((p) => ({
                  ...p,
                  items: p.items.map((b) => ({ ...b, isRead: true })),
                })),
              }
            : data,
      );
      // Zero out the folder's unread count (unfiled root has no folder cache entry).
      if (folderId) {
        qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
          (old ?? []).map((f) => (f.id === folderId ? { ...f, unreadCount: 0 } : f)),
        );
      }
      return { prev, prevFolders };
    },
    onError: (_e, _v, ctx) => {
      restoreLists(qc, ctx?.prev);
      if (ctx?.prevFolders) qc.setQueryData(qk.folders, ctx.prevFolders);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.bookmarks(folderId) });
      void qc.refetchQueries({ queryKey: qk.folders });
    },
  });
}

async function runBookmarkBatchChunks(
  ids: string[],
  run: (chunk: string[]) => Promise<{ updated: number }>,
): Promise<{ updated: number }> {
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH_ITEM_LIMIT) {
    const result = await run(ids.slice(i, i + BATCH_ITEM_LIMIT));
    updated += result.updated;
  }
  return { updated };
}

export function useBatchBookmarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: BOOKMARK_WRITE_KEY,
    mutationFn: ({
      action,
      ids,
      folderId,
      tagIds,
      scopeFolderId,
    }: {
      action: "delete" | "markRead" | "markUnread" | "move" | "addTags";
      ids: string[];
      folderId?: string | null;
      tagIds?: string[];
      scopeFolderId?: string | null;
    }) =>
      runBookmarkBatchChunks(ids, (chunk) => {
        if (action === "move") {
          return bookmarksApi.batch({ action, ids: chunk, folderId: folderId ?? null }, { folderId: scopeFolderId });
        }
        if (action === "addTags") {
          return bookmarksApi.batch({ action, ids: chunk, tagIds: tagIds ?? [] }, { folderId: scopeFolderId });
        }
        return bookmarksApi.batch({ action, ids: chunk }, { folderId: scopeFolderId });
      }),
    onMutate: async ({ action, ids, folderId }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["bookmarks"] }),
        qc.cancelQueries({ queryKey: qk.folders }),
      ]);
      const snapshots = qc.getQueriesData({ queryKey: ["bookmarks"] });
      const prevFolders = qc.getQueryData<FolderDto[]>(qk.folders);
      const idSet = new Set(ids);
      const originals = action === "move" ? collectCachedBookmarks(qc).filter((item) => idSet.has(item.id)) : [];
      if (action === "move") {
        const destination = folderId ?? null;
        moveBookmarksInCache(qc, originals.map((bookmark) => ({ ...bookmark, folderId: destination })));
        moveFolderCounts(qc, originals, destination);
      } else if (action === "delete") {
        removeBookmarksEverywhere(qc, idSet);
      } else if (action === "markRead") {
        updateBookmarksEverywhere(qc, idSet, (bookmark) => ({ ...bookmark, isRead: true }));
      } else if (action === "markUnread") {
        updateBookmarksEverywhere(qc, idSet, (bookmark) => ({
          ...bookmark,
          isRead: false,
          completedAt: null,
        }));
      }
      return { snapshots, prevFolders, originals };
    },
    onError: async (_e, variables, ctx) => {
      if (variables.action === "move") {
        await qc.cancelQueries({ queryKey: ["bookmarks"] });
        if (ctx) rollbackBookmarkMoves(qc, ctx.originals, variables.folderId ?? null, ctx.snapshots);
        return;
      }
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.prevFolders) qc.setQueryData(qk.folders, ctx.prevFolders);
    },
    onSuccess: async (_result, variables) => {
      if (variables.action !== "move") return;
      await qc.cancelQueries({ queryKey: ["bookmarks"] });
      const ids = new Set(variables.ids);
      moveBookmarksInCache(qc, collectCachedBookmarks(qc).filter((bookmark) => ids.has(bookmark.id))
        .map((bookmark) => ({ ...bookmark, folderId: variables.folderId ?? null })));
    },
    onSettled: (_data, _error, variables) => {
      if (variables.action === "delete" || variables.action === "addTags") {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }
      if (qc.isMutating({ mutationKey: BOOKMARK_WRITE_KEY }) > 1) return;
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
      void qc.invalidateQueries({ queryKey: qk.folders });
    },
  });
}

function replaceHighlights(
  current: BookmarkDetailDto | undefined,
  highlight: HighlightDto,
  absorbIds: string[] = [],
): BookmarkDetailDto | undefined {
  if (!current) return current;
  const absorbed = new Set(absorbIds);
  const next: HighlightDto[] = [];
  let inserted = false;
  for (const row of current.highlights ?? []) {
    if (row.id === highlight.id || absorbed.has(row.id)) {
      if (!inserted) {
        next.push(highlight);
        inserted = true;
      }
      continue;
    }
    next.push(row);
  }
  if (!inserted) next.push(highlight);
  return { ...current, highlights: next };
}

export function useCreateHighlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      folderId,
      exact,
      prefix,
      suffix,
      href,
    }: {
      id: string;
      folderId: string | null;
      exact: string;
      prefix?: string;
      suffix?: string;
      href?: string | null;
      absorbIds?: string[];
    }) => bookmarksApi.createHighlight(id, { exact, prefix, suffix, href }, { folderId }),
    onSuccess: (highlight, { id, absorbIds = [] }) => {
      qc.setQueryData<BookmarkDetailDto>(qk.bookmark(id), (current) =>
        replaceHighlights(current, highlight, absorbIds),
      );
    },
  });
}

export function useUpdateHighlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      highlightId,
      folderId,
      exact,
      prefix,
      suffix,
      href,
    }: {
      id: string;
      highlightId: string;
      folderId: string | null;
      exact: string;
      prefix?: string;
      suffix?: string;
      href?: string | null;
      absorbIds?: string[];
    }) =>
      bookmarksApi.updateHighlight(id, highlightId, { exact, prefix, suffix, href }, { folderId }),
    onSuccess: (highlight, { id, absorbIds = [] }) => {
      qc.setQueryData<BookmarkDetailDto>(qk.bookmark(id), (current) =>
        replaceHighlights(current, highlight, absorbIds),
      );
    },
  });
}

export function useRemoveHighlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      highlightId,
      folderId,
    }: {
      id: string;
      highlightId: string;
      folderId: string | null;
    }) => bookmarksApi.removeHighlight(id, highlightId, { folderId }),
    onMutate: ({ id, highlightId }) => {
      const previous = qc.getQueryData<BookmarkDetailDto>(qk.bookmark(id));
      qc.setQueryData<BookmarkDetailDto>(qk.bookmark(id), (current) =>
        current
          ? { ...current, highlights: (current.highlights ?? []).filter((row) => row.id !== highlightId) }
          : current,
      );
      return { previous };
    },
    onError: (_error, { id }, context) => {
      if (context?.previous) qc.setQueryData(qk.bookmark(id), context.previous);
    },
  });
}

export type { BookmarkDetailDto };
