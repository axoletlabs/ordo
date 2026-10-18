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
import { assertSessionScope, captureSessionScope, isSessionScopeCurrent } from "./session-scope";
import { foldersApi } from "./api/folders";
import { tagsApi } from "./api/tags";
import { sortFoldersDefault, sortTagsDefault } from "./list-sort";
import { qk, tagsAnyAccess } from "./api/query-keys";
import {
  moveFolderCounts,
  collectCachedBookmarks,
  insertBookmarksIfAbsent,
  mapCachedBookmarks,
  removeBookmarksEverywhere,
  removeRemindersFromCache,
  syncRemindersInCache,
} from "./cache-helpers";
import { deletedBookmarksToast, deletedFoldersToast, deletedTagsToast } from "./copy";
import { errorMessage } from "./error-message";
import { haptics } from "./haptics";
import { queryClient } from "./query-client";
import { useFolderTokenStore } from "../store/folder-tokens";
import { deleteJournalKey, forgetDeleteIntent, readDeleteIntents, recordDeleteIntent, type DeleteIntent } from "./delete-journal";

const UNDO_MS = 5_500;

const pendingBookmarkIds = new Set<string>();
const pendingFolderIds = new Set<string>();
const pendingTagIds = new Set<string>();
let stripperStarted = false;
const activeIntents = new Set<string>();
const pendingToastIds = new Set<string>();
let journalScope: string | null = null;
let scopeGeneration = 0;

export function isBookmarkDeletePending(id: string): boolean {
  return pendingBookmarkIds.has(id);
}

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
  return sortFoldersDefault(folders);
}

function sortTags(tags: TagDto[]) {
  return sortTagsDefault(tags);
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
  if (scope === "detail" || scope === "extraction-progress" || scope === "reminders") return false;
  return scope === folderId && (queryKey.length === 2 || queryKey.length === 3);
}

function collectBookmarksInFolders(folderIds: ReadonlySet<string>): BookmarkDto[] {
  if (folderIds.size === 0) return [];
  // Resolve the newest copy BEFORE filtering by folder. An obsolete reader or
  // inactive index must never make a moved-out bookmark part of this deletion.
  return collectCachedBookmarks(queryClient).filter((item) => item.folderId && folderIds.has(item.folderId));
}

interface BookmarkRestore {
  details: Map<string, BookmarkDetailDto | BookmarkDto>;
  lists: Map<string, (readonly unknown[])[]>;
}

function hideBookmarks(bookmarks: BookmarkDto[], bumpCounts: boolean) {
  const details = new Map<string, BookmarkDetailDto | BookmarkDto>();
  const lists = new Map<string, (readonly unknown[])[]>();
  if (bookmarks.length === 0) return { details, lists };
  const ids = new Set(bookmarks.map((bookmark) => bookmark.id));
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    const data = query.state.data;
    if (!isPagedBookmarks(data)) continue;
    for (const item of data.pages.flatMap((page) => page.items)) {
      if (!ids.has(item.id)) continue;
      lists.set(item.id, [...(lists.get(item.id) ?? []), query.queryKey]);
    }
  }
  for (const bookmark of bookmarks) {
    pendingBookmarkIds.add(bookmark.id);
    const detail = queryClient.getQueryData<BookmarkDetailDto | BookmarkDto>(qk.bookmark(bookmark.id));
    if (detail) details.set(bookmark.id, detail);
    if (bookmark.remindAt != null) {
      void import("./reminder-notifications").then(({ cancelBookmarkReminder }) =>
        cancelBookmarkReminder(bookmark.id),
      );
    }
  }
  removeBookmarksEverywhere(queryClient, ids);
  removeRemindersFromCache(queryClient, ids);
  queryClient.removeQueries({ queryKey: ["bookmarks", "detail"], predicate: (query) => ids.has(String(query.queryKey[2])) });
  if (bumpCounts) moveFolderCounts(queryClient, bookmarks, null);
  return { details, lists };
}

function restoreBookmarks(
  bookmarks: BookmarkDto[],
  snapshot: BookmarkRestore,
  bumpCounts: boolean,
) {
  if (bookmarks.length === 0) return;
  for (const bookmark of bookmarks) pendingBookmarkIds.delete(bookmark.id);
  const memberships = new Map<string, Set<string>>();
  for (const [id, keys] of snapshot.lists) {
    for (const key of keys) {
      const hash = JSON.stringify(key);
      const ids = memberships.get(hash) ?? new Set<string>();
      ids.add(id); memberships.set(hash, ids);
    }
  }
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    if (!isPagedBookmarks(query.state.data)) continue;
    const previouslyPresent = memberships.get(JSON.stringify(query.queryKey));
    const incoming = bookmarks.filter((bookmark) => previouslyPresent?.has(bookmark.id) || listKeyAllowsRestore(query.queryKey, bookmark.folderId));
    if (incoming.length) insertBookmarksIfAbsent(queryClient, query.queryKey, incoming);
  }
  if (bumpCounts) moveFolderCounts(queryClient, bookmarks, null, -1);
  syncRemindersInCache(queryClient, bookmarks.filter((bookmark) => bookmark.remindAt != null));
  for (const bookmark of bookmarks) {
    const detail = snapshot.details.get(bookmark.id);
    if (detail) queryClient.setQueryData(qk.bookmark(bookmark.id), detail);
    if (bookmark.remindAt != null) {
      void import("./reminder-notifications").then(({ syncBookmarkReminder }) =>
        syncBookmarkReminder(bookmark),
      );
    }
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

function releaseIntent(intent: DeleteIntent) {
  for (const bookmark of intent.bookmarks) pendingBookmarkIds.delete(bookmark.id);
  for (const id of intent.contained) pendingBookmarkIds.delete(id);
  for (const id of intent.folders) pendingFolderIds.delete(id);
  for (const id of intent.tags) pendingTagIds.delete(id);
}

function invalidateDeletedLists() {
  void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
  void queryClient.invalidateQueries({ queryKey: qk.folders });
  void queryClient.invalidateQueries({ queryKey: tagsAnyAccess });
}

function syncJournalScope() {
  const key = deleteJournalKey();
  if (journalScope !== key) {
    for (const id of pendingToastIds) toast.dismiss(id);
    pendingToastIds.clear();
    pendingBookmarkIds.clear(); pendingFolderIds.clear(); pendingTagIds.clear();
    activeIntents.clear();
    journalScope = key;
    scopeGeneration += 1;
  }
  return key;
}

/** A replay may follow a successful DELETE whose response was lost. */
async function deleteIfPresent(run: () => Promise<unknown>) {
  try { await run(); } catch (cause) {
    if ((cause as { status?: number }).status !== 404) throw cause;
  }
}

async function replayDeleteIntent(key: string, intent: DeleteIntent) {
  const owner = captureSessionScope();
  const assertScope = () => {
    assertSessionScope(owner);
    if (deleteJournalKey() !== key) throw new Error("Deletion paused after account or server changed.");
  };
  const removeChunks = async (ids: string[], batch: (ids: string[]) => Promise<unknown>, single: (id: string) => Promise<unknown>) => {
    for (let offset = 0; offset < ids.length; offset += BATCH_ITEM_LIMIT) {
      assertScope();
      const chunk = ids.slice(offset, offset + BATCH_ITEM_LIMIT);
      if (chunk.length > 1) {
        try { await batch(chunk); continue; } catch (cause) {
          // Partially completed replays can contain an already-deleted ID.
          if ((cause as { status?: number }).status !== 404) throw cause;
        }
      }
      for (const id of chunk) {
        assertScope();
        await deleteIfPresent(() => single(id));
      }
    }
  };
  const bookmarksById = new Map(intent.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  await removeChunks(intent.bookmarks.map((bookmark) => bookmark.id),
    (ids) => bookmarksApi.batch({ action: "delete", ids }),
    (id) => bookmarksApi.remove(id, { folderId: bookmarksById.get(id)?.folderId }));
  await removeChunks(intent.folders, (ids) => foldersApi.batch({ action: "delete", ids }), (id) => foldersApi.remove(id));
  for (const id of intent.tags) {
    assertScope();
    await deleteIfPresent(() => tagsApi.remove(id));
  }
  assertScope();
  forgetDeleteIntent(key, intent.id);
  if (deleteJournalKey() !== key) return;
  releaseIntent(intent);
  for (const id of intent.folders) useFolderTokenStore.getState().clear(id);
  invalidateDeletedLists();
}

/** Restore ID-only tombstones before launch/foreground queries paint. A new
 * process has no Undo surface, so finish durable intents instead of losing them. */
export function resumePendingDeletes() {
  const key = syncJournalScope();
  if (!key) return;
  try {
    const intents = readDeleteIntents(key);
    if (intents.length === 0) return;
    ensurePendingStripper();
    for (const intent of intents) {
      const activeKey = `${key}:${intent.id}`;
      for (const bookmark of intent.bookmarks) pendingBookmarkIds.add(bookmark.id);
      for (const id of intent.contained) pendingBookmarkIds.add(id);
      for (const id of intent.folders) pendingFolderIds.add(id);
      for (const id of intent.tags) pendingTagIds.add(id);
      if (activeIntents.has(activeKey)) continue;
      activeIntents.add(activeKey);
      const owner = captureSessionScope();
      void replayDeleteIntent(key, intent).catch((cause) => {
        if (!isSessionScopeCurrent(owner) || deleteJournalKey() !== key) return;
        const status = (cause as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          // Expired folder access requires an explicit unlock, not an invisible
          // deletion that retries forever. Refetch restores the server's rows.
          try { forgetDeleteIntent(key, intent.id); } catch (storageError) {
            toast.error(errorMessage(storageError, "Couldn't save deletion status."));
            return;
          }
          releaseIntent(intent);
          invalidateDeletedLists();
        }
        toast.error(status && status >= 400 && status < 500 ? errorMessage(cause)
          : `${errorMessage(cause)} Deletion will retry when you return online.`);
      }).finally(() => activeIntents.delete(activeKey));
    }
    // The disk cache may already contain these rows. Apply tombstones now,
    // rather than waiting for a network/cache event to trigger the subscriber.
    for (const query of queryClient.getQueryCache().getAll()) {
      if (["bookmarks", "folders", "tags"].includes(String(query.queryKey[0]))) {
        queryClient.setQueryData(query.queryKey, query.state.data);
      }
    }
  } catch (cause) {
    toast.error(errorMessage(cause, "Couldn't restore pending deletions."));
  }
}

export function deleteUndoable(opts: UndoableDeleteOpts): { undo: () => void; commit: () => void } {
  const owner = captureSessionScope();
  const noop = { undo: () => {}, commit: () => {} };
  syncJournalScope();
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

  let journal: ReturnType<typeof recordDeleteIntent>;
  try {
    journal = recordDeleteIntent({
      bookmarks: standalone.map(({ id, folderId }) => ({ id, folderId })),
      folders: folders.map((folder) => folder.id), tags: tags.map((tag) => tag.id),
      contained: contained.map((bookmark) => bookmark.id),
    });
  } catch (cause) {
    toast.error(errorMessage(cause, "Couldn't save deletion. Nothing was deleted."));
    return noop;
  }
  journalScope = journal.key;
  const activeKey = `${journal.key}:${journal.intent.id}`;
  const generation = scopeGeneration;
  activeIntents.add(activeKey);

  hideFolders(folders);
  const containedDetails = hideBookmarks(contained, false);
  const standaloneDetails = hideBookmarks(standalone, true);
  const tagAssignments = hideTags(tags);
  opts.onDeleted?.();

  let settled = false;
  const showToast = opts.showToast !== false;

  const restore = () => {
    restoreFolders(folders);
    restoreBookmarks(contained, containedDetails, false);
    restoreBookmarks(standalone, standaloneDetails, true);
    restoreTags(tags, tagAssignments);
  };

  const settle = (undo: boolean): boolean => {
    if (settled) return true;
    if (!isSessionScopeCurrent(owner) || deleteJournalKey() !== journal.key || generation !== scopeGeneration) return false;
    if (undo) {
      try { forgetDeleteIntent(journal.key, journal.intent.id); } catch (cause) {
        toast.error(errorMessage(cause, "Couldn't save Undo. Try again."));
        return false;
      }
    }
    settled = true;
    if (undo) {
      activeIntents.delete(activeKey);
      haptics.success();
      restore();
      invalidateDeletedLists();
      return true;
    }
    void replayDeleteIntent(journal.key, journal.intent).catch((cause) => {
      if (!isSessionScopeCurrent(owner) || deleteJournalKey() !== journal.key || generation !== scopeGeneration) return;
      const status = (cause as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        try { forgetDeleteIntent(journal.key, journal.intent.id); } catch (storageError) {
          toast.error(errorMessage(storageError, "Couldn't save deletion status."));
          return;
        }
        restore();
        invalidateDeletedLists();
      }
      // Network failures retain the durable intent and tombstones for replay.
      toast.error(status && status >= 400 && status < 500 ? errorMessage(cause)
        : `${errorMessage(cause)} Deletion will retry when you return online.`);
    }).finally(() => activeIntents.delete(activeKey));
    return true;
  };

  if (showToast) {
    const id = toast.success(toastMessage(selectedBookmarks.length, folders.length, tags), {
      duration: UNDO_MS,
      action: { label: "Undo", onPress: () => settle(true) },
      onDismiss: () => {
        pendingToastIds.delete(id);
        settle(false);
      },
    });
    pendingToastIds.add(id);
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
