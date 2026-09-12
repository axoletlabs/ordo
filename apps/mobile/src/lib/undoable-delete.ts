/**
 * Optimistic delete with a short undo window. The row leaves the UI immediately;
 * the server delete waits until Undo is skipped (toast dismiss, timeout, or Done).
 * Covers bookmarks, folders, tags, and mixed batch selection.
 */
import type { InfiniteData } from "@tanstack/react-query";
import {
  BATCH_ITEM_LIMIT,
  type BookmarkDetailDto,
  type BookmarkDto,
  type CursorPage,
  type FolderDto,
  type TagDto,
  type TagSummaryDto,
} from "@ordo/shared";
import { toast } from "../components/ui/toast-store";
import { bookmarksApi } from "./api/bookmarks";
import { foldersApi } from "./api/folders";
import { tagsApi } from "./api/tags";
import { qk, tagsAnyAccess } from "./api/query-keys";
import {
  bumpFolderCount,
  insertBookmarkIfAbsent,
  mapCachedBookmarks,
  removeBookmarksEverywhere,
} from "./cache-helpers";
import { deletedBookmarksToast, deletedFoldersToast, deletedTagsToast } from "./copy";
import { errorMessage } from "./error-message";
import { haptics } from "./haptics";
import { queryClient } from "./query-client";
import { useFolderTokenStore } from "../store/folder-tokens";

const UNDO_MS = 5_500;
const COMMIT_FALLBACK_MS = UNDO_MS + 800;

const pendingBookmarkIds = new Set<string>();
const pendingFolderIds = new Set<string>();
const pendingTagIds = new Set<string>();
let stripperStarted = false;

function isPagedBookmarks(
  data: unknown,
): data is InfiniteData<CursorPage<BookmarkDto>, string | null> {
  return !!data && typeof data === "object" && Array.isArray((data as { pages?: unknown }).pages);
}

function isBookmarkRecord(data: unknown): data is BookmarkDto {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as BookmarkDto).id === "string" &&
    typeof (data as BookmarkDto).url === "string"
  );
}

function sortFolders(folders: FolderDto[]) {
  return [...folders].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt),
  );
}

function sortTags(tags: TagDto[]) {
  return [...tags].sort(
    (a, b) => b.bookmarkCount - a.bookmarkCount || a.name.localeCompare(b.name),
  );
}

function tagSummary(tag: TagDto): TagSummaryDto {
  return { id: tag.id, name: tag.name, color: tag.color };
}

function ensurePendingStripper() {
  if (stripperStarted) return;
  stripperStarted = true;
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const key = event.query.queryKey;
    const data = event.query.state.data;

    if (key[0] === "folders" && pendingFolderIds.size > 0) {
      const folders = data as FolderDto[] | undefined;
      if (Array.isArray(folders) && folders.some((folder) => pendingFolderIds.has(folder.id))) {
        queryClient.setQueryData<FolderDto[]>(
          event.query.queryKey,
          folders.filter((folder) => !pendingFolderIds.has(folder.id)),
        );
      }
    }

    if (key[0] === "tags" && pendingTagIds.size > 0) {
      const tags = data as TagDto[] | undefined;
      if (Array.isArray(tags) && tags.some((tag) => pendingTagIds.has(tag.id))) {
        queryClient.setQueryData<TagDto[]>(
          event.query.queryKey,
          tags.filter((tag) => !pendingTagIds.has(tag.id)),
        );
      }
    }

    if (key[0] !== "bookmarks") return;
    if (key[1] === "extraction-progress") return;

    if (key[1] === "detail" && isBookmarkRecord(data)) {
      if (pendingBookmarkIds.has(data.id) || (data.folderId && pendingFolderIds.has(data.folderId))) {
        queryClient.removeQueries({ queryKey: event.query.queryKey });
      } else if (pendingTagIds.size > 0 && bookmarkHasPendingTag(data)) {
        queryClient.setQueryData(event.query.queryKey, stripPendingTags(data));
      }
      return;
    }

    if (!isPagedBookmarks(data)) return;
    const needsHide = data.pages.some(
      (page) =>
        Array.isArray(page?.items) &&
        page.items.some(
          (item) =>
            pendingBookmarkIds.has(item.id) || (item.folderId != null && pendingFolderIds.has(item.folderId)),
        ),
    );
    const needsTagStrip =
      pendingTagIds.size > 0 &&
      data.pages.some(
        (page) => Array.isArray(page?.items) && page.items.some((item) => bookmarkHasPendingTag(item)),
      );
    if (!needsHide && !needsTagStrip) return;

    queryClient.setQueryData(event.query.queryKey, {
      ...data,
      pages: data.pages.map((page) => {
        if (!page || !Array.isArray(page.items)) return page;
        return {
          ...page,
          items: page.items
            .filter(
              (item) =>
                !pendingBookmarkIds.has(item.id) &&
                !(item.folderId != null && pendingFolderIds.has(item.folderId)),
            )
            .map((item) => (needsTagStrip ? stripPendingTags(item) : item)),
        };
      }),
    });
  });
}

function bookmarkHasPendingTag(bookmark: BookmarkDto) {
  return (
    bookmark.tags?.some((tag) => pendingTagIds.has(tag.id)) ||
    bookmark.suggestedTags?.some((tag) => pendingTagIds.has(tag.id))
  );
}

function stripPendingTags(bookmark: BookmarkDto): BookmarkDto {
  if (!Array.isArray(bookmark.tags) || !Array.isArray(bookmark.suggestedTags)) return bookmark;
  const tags = bookmark.tags.filter((tag) => !pendingTagIds.has(tag.id));
  const suggestedTags = bookmark.suggestedTags.filter((tag) => !pendingTagIds.has(tag.id));
  if (tags.length === bookmark.tags.length && suggestedTags.length === bookmark.suggestedTags.length) {
    return bookmark;
  }
  return { ...bookmark, tags, suggestedTags };
}

function listKeyAllowsRestore(queryKey: readonly unknown[], folderId: string | null): boolean {
  if (queryKey[0] !== "bookmarks") return false;
  const scope = queryKey[1];
  if (scope === "detail" || scope === "extraction-progress") return false;
  if (scope === "search" || scope === "tagged") return true;
  return scope === folderId && (queryKey.length === 2 || queryKey.length === 3);
}

function collectBookmarksInFolders(folderIds: ReadonlySet<string>): BookmarkDto[] {
  if (folderIds.size === 0) return [];
  const found = new Map<string, BookmarkDto>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    const data = query.state.data;
    if (isPagedBookmarks(data)) {
      for (const page of data.pages) {
        for (const item of page.items) {
          if (item.folderId && folderIds.has(item.folderId)) found.set(item.id, item);
        }
      }
    } else if (isBookmarkRecord(data) && data.folderId && folderIds.has(data.folderId)) {
      found.set(data.id, data);
    }
  }
  return [...found.values()];
}

function hideBookmarks(bookmarks: BookmarkDto[], bumpCounts: boolean) {
  const details = new Map<string, BookmarkDetailDto | BookmarkDto>();
  if (bookmarks.length === 0) return details;
  for (const bookmark of bookmarks) {
    pendingBookmarkIds.add(bookmark.id);
    const detail = queryClient.getQueryData<BookmarkDetailDto | BookmarkDto>(qk.bookmark(bookmark.id));
    if (detail) details.set(bookmark.id, detail);
  }
  removeBookmarksEverywhere(queryClient, new Set(bookmarks.map((bookmark) => bookmark.id)));
  for (const bookmark of bookmarks) {
    queryClient.removeQueries({ queryKey: qk.bookmark(bookmark.id) });
    if (bumpCounts) bumpFolderCount(queryClient, bookmark.folderId, -1, bookmark.isRead ? 0 : -1);
  }
  return details;
}

function restoreBookmarks(
  bookmarks: BookmarkDto[],
  details: Map<string, BookmarkDetailDto | BookmarkDto>,
  bumpCounts: boolean,
) {
  if (bookmarks.length === 0) return;
  for (const bookmark of bookmarks) pendingBookmarkIds.delete(bookmark.id);
  for (const bookmark of bookmarks) {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
      if (!listKeyAllowsRestore(query.queryKey, bookmark.folderId)) continue;
      insertBookmarkIfAbsent(queryClient, query.queryKey, bookmark);
    }
    if (bumpCounts) bumpFolderCount(queryClient, bookmark.folderId, +1, bookmark.isRead ? 0 : +1);
    const detail = details.get(bookmark.id);
    if (detail) queryClient.setQueryData(qk.bookmark(bookmark.id), detail);
  }
}

function hideFolders(folders: FolderDto[]) {
  if (folders.length === 0) return;
  const ids = new Set(folders.map((folder) => folder.id));
  for (const id of ids) pendingFolderIds.add(id);
  queryClient.setQueryData<FolderDto[]>(qk.folders, (old) =>
    (old ?? []).filter((folder) => !ids.has(folder.id)),
  );
}

function restoreFolders(folders: FolderDto[]) {
  if (folders.length === 0) return;
  for (const folder of folders) pendingFolderIds.delete(folder.id);
  queryClient.setQueryData<FolderDto[]>(qk.folders, (old) => {
    const existing = new Set((old ?? []).map((folder) => folder.id));
    return sortFolders([...(old ?? []), ...folders.filter((folder) => !existing.has(folder.id))]);
  });
}

interface TagPresence {
  inTags: boolean;
  inSuggested: boolean;
}

function hideTags(tags: TagDto[]) {
  const assignments = new Map<string, Map<string, TagPresence>>();
  if (tags.length === 0) return assignments;
  const ids = new Set(tags.map((tag) => tag.id));
  for (const id of ids) pendingTagIds.add(id);
  queryClient.setQueriesData<TagDto[]>({ queryKey: tagsAnyAccess }, (old) =>
    old ? old.filter((tag) => !ids.has(tag.id)) : old,
  );

  mapCachedBookmarks(queryClient, (bookmark) => {
    for (const tagId of ids) {
      const inTags = bookmark.tags.some((tag) => tag.id === tagId);
      const inSuggested = bookmark.suggestedTags.some((tag) => tag.id === tagId);
      if (!inTags && !inSuggested) continue;
      let byTag = assignments.get(bookmark.id);
      if (!byTag) {
        byTag = new Map();
        assignments.set(bookmark.id, byTag);
      }
      byTag.set(tagId, { inTags, inSuggested });
    }
    return stripPendingTags(bookmark);
  });

  return assignments;
}

function restoreTags(tags: TagDto[], assignments: Map<string, Map<string, TagPresence>>) {
  if (tags.length === 0) return;
  for (const tag of tags) pendingTagIds.delete(tag.id);
  queryClient.setQueriesData<TagDto[]>({ queryKey: tagsAnyAccess }, (old) => {
    if (!old) return old;
    const existing = new Set(old.map((tag) => tag.id));
    return sortTags([...old, ...tags.filter((tag) => !existing.has(tag.id))]);
  });
  if (assignments.size === 0) return;
  const summaries = new Map(tags.map((tag) => [tag.id, tagSummary(tag)]));
  mapCachedBookmarks(queryClient, (bookmark) => {
    const byTag = assignments.get(bookmark.id);
    if (!byTag) return bookmark;
    let nextTags = bookmark.tags;
    let nextSuggested = bookmark.suggestedTags;
    for (const [tagId, presence] of byTag) {
      const summary = summaries.get(tagId);
      if (!summary) continue;
      if (presence.inTags && !nextTags.some((tag) => tag.id === tagId)) {
        nextTags = [...nextTags, summary];
      }
      if (presence.inSuggested && !nextSuggested.some((tag) => tag.id === tagId)) {
        nextSuggested = [...nextSuggested, summary];
      }
    }
    return { ...bookmark, tags: nextTags, suggestedTags: nextSuggested };
  });
}

async function commitBookmarkDeletes(bookmarks: BookmarkDto[], scopeFolderId?: string | null) {
  if (bookmarks.length === 0) return;
  if (bookmarks.length === 1) {
    const bookmark = bookmarks[0];
    await bookmarksApi.remove(bookmark.id, { folderId: bookmark.folderId ?? scopeFolderId ?? null });
  } else {
    const ids = bookmarks.map((bookmark) => bookmark.id);
    for (let i = 0; i < ids.length; i += BATCH_ITEM_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_ITEM_LIMIT);
      await bookmarksApi.batch({ action: "delete", ids: chunk }, { folderId: scopeFolderId });
    }
  }
  for (const bookmark of bookmarks) pendingBookmarkIds.delete(bookmark.id);
  void queryClient.invalidateQueries({ queryKey: ["tags"] });
  void queryClient.invalidateQueries({ queryKey: ["bookmarks", "tagged"] });
  void queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] });
}

async function commitFolderDeletes(folders: FolderDto[], contained: BookmarkDto[]) {
  if (folders.length === 0) return;
  const ids = folders.map((folder) => folder.id);
  if (ids.length === 1) {
    await foldersApi.remove(ids[0]);
  } else {
    for (let i = 0; i < ids.length; i += BATCH_ITEM_LIMIT) {
      await foldersApi.batch({ action: "delete", ids: ids.slice(i, i + BATCH_ITEM_LIMIT) });
    }
  }
  for (const folder of folders) {
    pendingFolderIds.delete(folder.id);
    useFolderTokenStore.getState().clear(folder.id);
  }
  for (const bookmark of contained) pendingBookmarkIds.delete(bookmark.id);
  void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
  void queryClient.invalidateQueries({ queryKey: qk.folders });
  void queryClient.invalidateQueries({ queryKey: tagsAnyAccess });
}

async function commitTagDeletes(tags: TagDto[]) {
  if (tags.length === 0) return;
  for (const tag of tags) {
    await tagsApi.remove(tag.id);
    pendingTagIds.delete(tag.id);
  }
  void queryClient.invalidateQueries({ queryKey: tagsAnyAccess });
  void queryClient.invalidateQueries({ queryKey: ["bookmarks", "tagged"] });
  void queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] });
}

function toastMessage(bookmarks: number, folders: number, tags: readonly TagDto[]): string {
  if (tags.length > 0 && bookmarks === 0 && folders === 0) return deletedTagsToast(tags);
  if (folders > 0 && bookmarks > 0) return "Deleted";
  if (folders > 0) return deletedFoldersToast(folders);
  if (bookmarks > 0) return deletedBookmarksToast(bookmarks);
  return "Deleted";
}

export interface UndoableDeleteOpts {
  bookmarks?: readonly BookmarkDto[];
  folders?: readonly FolderDto[];
  tags?: readonly TagDto[];
  scopeFolderId?: string | null;
  onDeleted?: () => void;
  showToast?: boolean;
}

export function deleteUndoable(opts: UndoableDeleteOpts): { undo: () => void; commit: () => void } {
  const noop = { undo: () => {}, commit: () => {} };
  const folders = (opts.folders ?? []).filter((folder) => !pendingFolderIds.has(folder.id));
  const tags = (opts.tags ?? []).filter((tag) => !pendingTagIds.has(tag.id));
  const selectedBookmarks = (opts.bookmarks ?? []).filter(
    (bookmark) => !pendingBookmarkIds.has(bookmark.id),
  );
  if (folders.length === 0 && tags.length === 0 && selectedBookmarks.length === 0) return noop;

  ensurePendingStripper();

  const folderIds = new Set(folders.map((folder) => folder.id));
  const standalone = selectedBookmarks.filter(
    (bookmark) => !bookmark.folderId || !folderIds.has(bookmark.folderId),
  );
  const contained = collectBookmarksInFolders(folderIds).filter(
    (bookmark) => !pendingBookmarkIds.has(bookmark.id) && !standalone.some((item) => item.id === bookmark.id),
  );

  hideFolders(folders);
  const containedDetails = hideBookmarks(contained, false);
  const standaloneDetails = hideBookmarks(standalone, true);
  const tagAssignments = hideTags(tags);
  opts.onDeleted?.();

  let settled = false;
  const showToast = opts.showToast !== false;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  const restore = () => {
    restoreFolders(folders);
    restoreBookmarks(contained, containedDetails, false);
    restoreBookmarks(standalone, standaloneDetails, true);
    restoreTags(tags, tagAssignments);
  };

  const settle = (undo: boolean) => {
    if (settled) return;
    settled = true;
    if (fallback) clearTimeout(fallback);
    if (undo) {
      haptics.success();
      restore();
      return;
    }
    void (async () => {
      await commitBookmarkDeletes(standalone, opts.scopeFolderId);
      await commitFolderDeletes(folders, contained);
      await commitTagDeletes(tags);
    })().catch((cause) => {
      restore();
      toast.error(errorMessage(cause));
    });
  };

  if (showToast) {
    fallback = setTimeout(() => settle(false), COMMIT_FALLBACK_MS);
    toast.success(toastMessage(selectedBookmarks.length, folders.length, tags), {
      duration: UNDO_MS,
      action: { label: "Undo", onPress: () => settle(true) },
      onDismiss: () => settle(false),
    });
  }

  return {
    undo: () => settle(true),
    commit: () => settle(false),
  };
}

export function deleteBookmarksUndoable(
  bookmarks: BookmarkDto[],
  opts?: { scopeFolderId?: string | null; onDeleted?: () => void; showToast?: boolean },
): { undo: () => void; commit: () => void } {
  return deleteUndoable({ bookmarks, ...opts });
}
