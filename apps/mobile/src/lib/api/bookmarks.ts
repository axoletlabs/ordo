/**
 * Bookmarks API endpoints.
 */
import { BookmarkRoutes, buildPath, type BatchBookmarksInput } from "@ordo/shared";
import { api } from "./client";

/** `folderId` is null for the unfiled root list ("Bookmarks"). */
export interface ListBookmarksParams {
  folderId: string | null;
  cursor?: string | null;
  limit?: number;
}

export const bookmarksApi = {
  create: (url: string, folderId: string | null, tagIds: string[] = []) =>
    api.post<typeof BookmarkRoutes.create.response>(
      BookmarkRoutes.create.path,
      { url, folderId, tagIds },
      { folderId },
    ),

  list: ({ folderId, cursor, limit }: ListBookmarksParams) =>
    api.get<typeof BookmarkRoutes.list.response>(BookmarkRoutes.list.path, {
      query: { folderId, cursor, limit },
      folderId,
    }),

  /** Whole-library list filtered by tags (AND semantics). */
  listTagged: (tagIds: string[], cursor?: string | null, limit?: number) =>
    api.get<typeof BookmarkRoutes.list.response>(BookmarkRoutes.list.path, {
      query: {
        scope: "all",
        tagIds: tagIds.length > 0 ? tagIds.join(",") : undefined,
        cursor,
        limit,
      },
      folderTokens: true,
    }),

  search: (
    q: string,
    cursor?: string | null,
    limit?: number,
    tagIds: string[] = [],
    unread: "all" | "unread" | "read" = "all",
    folderIds: string[] = [],
    unfiled = false,
    fuzzy = false,
  ) =>
    api.get<typeof BookmarkRoutes.search.response>(BookmarkRoutes.search.path, {
      query: {
        q,
        cursor,
        limit,
        tagIds: tagIds.length > 0 ? tagIds.join(",") : undefined,
        folderIds: folderIds.length > 0 ? folderIds.join(",") : undefined,
        unfiled: unfiled ? "1" : undefined,
        fuzzy: fuzzy ? "1" : undefined,
        unread: unread === "unread" ? "1" : unread === "read" ? "0" : undefined,
      },
      auth: true,
      folderTokens: true,
    }),

  detail: (id: string, folderId?: string | null) =>
    api.get<typeof BookmarkRoutes.detail.response>(
      buildPath(BookmarkRoutes.detail.path, { id }),
      { folderId },
    ),

  update: (
    id: string,
    body: { folderId?: string | null; isRead?: boolean; readProgress?: number; contentKindOverride?: "article" | "web" | null },
    opts?: { folderId?: string | null },
  ) =>
    api.patch<typeof BookmarkRoutes.update.response>(
      buildPath(BookmarkRoutes.update.path, { id }),
      body,
      opts,
    ),

  setContentKind: (
    id: string,
    contentKindOverride: "article" | "web",
    opts?: { folderId?: string | null },
  ) =>
    api.put<typeof BookmarkRoutes.setContentKind.response>(
      buildPath(BookmarkRoutes.setContentKind.path, { id }),
      { contentKindOverride },
      opts,
    ),

  remove: (id: string, opts?: { folderId?: string | null }) =>
    api.delete<typeof BookmarkRoutes.remove.response>(
      buildPath(BookmarkRoutes.remove.path, { id }),
      opts,
    ),

  /** Atomically replace a bookmark's tags and dismiss the given suggestions. */
  updateTags: (
    id: string,
    body: { tagIds: string[]; dismissedSuggestionIds?: string[] },
    opts?: { folderId?: string | null },
  ) =>
    api.put<typeof BookmarkRoutes.updateTags.response>(
      buildPath(BookmarkRoutes.updateTags.path, { id }),
      { tagIds: body.tagIds, dismissedSuggestionIds: body.dismissedSuggestionIds ?? [] },
      opts,
    ),

  markAllRead: (folderId: string | null) =>
    api.post<typeof BookmarkRoutes.markAllRead.response>(
      BookmarkRoutes.markAllRead.path,
      { folderId },
      { folderId },
    ),

  batch: (body: BatchBookmarksInput, opts?: { folderId?: string | null }) =>
    api.post<typeof BookmarkRoutes.batch.response>(BookmarkRoutes.batch.path, body, {
      folderId: opts?.folderId,
      folderTokens: true,
    }),

  extractionProgress: () =>
    api.get<typeof BookmarkRoutes.extractionProgress.response>(
      BookmarkRoutes.extractionProgress.path,
    ),

  prefetch: (url: string) =>
    api.post<typeof BookmarkRoutes.prefetch.response>(BookmarkRoutes.prefetch.path, { url }),
};
