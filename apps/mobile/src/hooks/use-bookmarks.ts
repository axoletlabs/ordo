/**
 * Bookmark queries + mutations. Optimistic updates keep the UI instant;
 * background refetch reconciles with the server.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { bookmarksApi } from "../lib/api/bookmarks";
import { queryClient } from "../lib/query-client";
import { useFolderTokenStore } from "../store/folder-tokens";
import { qk } from "../lib/api/query-keys";
import {
  bumpFolderCount,
  patchListsFromDetail,
  prependBookmarkToPages,
  removeBookmarkFromPages,
  removeBookmarksEverywhere,
  updateBookmarkEverywhere,
  updateBookmarkInPages,
  updateBookmarksEverywhere,
} from "../lib/cache-helpers";
import { deleteBookmarksUndoable } from "../lib/undoable-delete";
import {
  BATCH_ITEM_LIMIT,
  DEFAULT_PAGE_SIZE,
  extractionPollIntervalMs,
  type BookmarkDetailDto,
  type BookmarkDto,
  type FolderDto,
} from "@ordo/shared";

export function prefetchFolderBookmarks(folderId: string) {
  return queryClient.prefetchInfiniteQuery({
    queryKey: qk.bookmarks(folderId),
    queryFn: ({ pageParam }) =>
      bookmarksApi.list({ folderId, cursor: pageParam ?? undefined, limit: DEFAULT_PAGE_SIZE }),
    initialPageParam: null as string | null,
  });
}

export function useInfiniteBookmarks(folderId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.bookmarks(folderId),
    queryFn: ({ pageParam }) =>
      bookmarksApi.list({ folderId, cursor: pageParam ?? undefined, limit: DEFAULT_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    enabled,
  });
}

export function useInfiniteSearch(q: string, tagIds: readonly string[] = []) {
  return useInfiniteQuery({
    queryKey: qk.search(q, tagIds),
    queryFn: ({ pageParam }) =>
      bookmarksApi.search(q, pageParam ?? undefined, DEFAULT_PAGE_SIZE, [...tagIds]),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    enabled: q.trim().length > 0 || tagIds.length > 0,
    placeholderData: (prev) => prev,
  });
}

export function useBookmarkDetail(id: string, enabled = true, folderId?: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.bookmark(id),
    queryFn: async () => {
      const detail = await bookmarksApi.detail(id, folderId);
      patchListsFromDetail(qc, detail);
      return detail;
    },
    enabled: !!id && enabled,
    staleTime: (query) =>
      query.state.data?.fetchStatus === "pending" ||
      (query.state.data?.contentKindOverride === "article" &&
        query.state.data.fetchStatus !== "ok")
        ? 0
        : 5 * 60_000,
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
      prependBookmarkToPages(qc, qk.bookmarks(bookmark.folderId), bookmark);
      bumpFolderCount(qc, bookmark.folderId, +1, bookmark.isRead ? 0 : +1);
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
      const prev = qc.getQueryData(qk.bookmarks(folderId));
      const prevFolders = qc.getQueryData<FolderDto[]>(qk.folders);
      updateBookmarkInPages(qc, qk.bookmarks(folderId), id, (b) => ({ ...b, isRead }));
      bumpFolderCount(qc, folderId, 0, isRead ? -1 : +1);
      return { prev, prevFolders };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.bookmarks(folderId), ctx.prev);
      if (ctx?.prevFolders) qc.setQueryData(qk.folders, ctx.prevFolders);
    },
    onSuccess: (updated) => {
      // Reconcile every other view (tag lists, search, detail) with the server.
      updateBookmarkEverywhere(qc, updated.id, (bookmark) => ({ ...bookmark, ...updated }));
    },
  });
}

/** Mark a bookmark read when its folder is only known at tap time (search). */
export function useMarkBookmarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      bookmarksApi.update(id, { isRead: true }, { folderId }),
    onSuccess: (updated) => {
      updateBookmarkEverywhere(qc, updated.id, (bookmark) => ({ ...bookmark, ...updated }));
      void qc.invalidateQueries({ queryKey: qk.folders });
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
            contentMarkdown: null,
            contentText: null,
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
    mutationFn: ({ id, toFolderId }: { id: string; toFolderId: string | null }) =>
      bookmarksApi.update(id, { folderId: toFolderId }, {
        folderId:
          toFolderId && useFolderTokenStore.getState().get(toFolderId)
            ? toFolderId
            : fromFolderId,
      }),
    onMutate: ({ id, toFolderId }) => {
      const prev = qc.getQueryData(qk.bookmarks(fromFolderId));
      const prevDestination = qc.getQueryData(qk.bookmarks(toFolderId));
      const prevFolders = qc.getQueryData<FolderDto[]>(qk.folders);
      let unreadDelta = 0;
      const list = qc.getQueryData<{ pages: { items: BookmarkDto[] }[] }>(qk.bookmarks(fromFolderId));
      const target = list?.pages.flatMap((p) => p.items).find((b) => b.id === id);
      if (target) {
        unreadDelta = target.isRead ? 0 : -1;
        // Optimistically appear in destination too (best-effort).
        prependBookmarkToPages(qc, qk.bookmarks(toFolderId), { ...target, folderId: toFolderId });
      }
      removeBookmarkFromPages(qc, qk.bookmarks(fromFolderId), id);
      bumpFolderCount(qc, fromFolderId, -1, unreadDelta);
      bumpFolderCount(qc, toFolderId, +1, target && !target.isRead ? +1 : 0);
      return { prev, prevDestination, prevFolders, toFolderId };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.bookmarks(fromFolderId), ctx.prev);
      if (ctx?.prevDestination) qc.setQueryData(qk.bookmarks(ctx.toFolderId), ctx.prevDestination);
      if (ctx?.prevFolders) qc.setQueryData(qk.folders, ctx.prevFolders);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });
}

export function useMarkAllRead(folderId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bookmarksApi.markAllRead(folderId),
    onMutate: () => {
      const prev = qc.getQueryData(qk.bookmarks(folderId));
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
        queryClient.setQueryData<FolderDto[]>(qk.folders, (old) =>
          (old ?? []).map((f) => (f.id === folderId ? { ...f, unreadCount: 0 } : f)),
        );
      }
      return { prev, prevFolders };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.bookmarks(folderId), ctx.prev);
      if (ctx?.prevFolders) qc.setQueryData(qk.folders, ctx.prevFolders);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.bookmarks(folderId) });
      void queryClient.refetchQueries({ queryKey: qk.folders });
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
    onMutate: ({ action, ids }) => {
      const snapshots = qc.getQueriesData({ queryKey: ["bookmarks"] });
      const prevFolders = qc.getQueryData<FolderDto[]>(qk.folders);
      const idSet = new Set(ids);
      if (action === "delete") {
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
      return { snapshots, prevFolders };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.prevFolders) qc.setQueryData(qk.folders, ctx.prevFolders);
    },
    onSettled: (_data, _error, variables) => {
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
      void qc.invalidateQueries({ queryKey: qk.folders });
      if (variables.action === "delete" || variables.action === "addTags") {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }
    },
  });
}

export type { BookmarkDetailDto };
