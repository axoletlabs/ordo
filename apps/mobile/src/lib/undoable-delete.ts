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
  moveBookmarksInCache,
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
    // Nothing is awaiting Undo: the filters below would be no-ops, but each
    // would still walk every page of the updated query. Catalogue warm-up and
    // reader progress flushes must not pay for a delete that already settled.
    if (pendingBookmarkIds.size === 0 && pendingFolderIds.size === 0 && pendingTagIds.size === 0) return;
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
    const rowsPending = pendingBookmarkIds.size > 0 || pendingFolderIds.size > 0;
    const needsHide = rowsPending && data.pages.some(
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

/** Does this cached payload still hold a row the journal says is being
 * deleted (and therefore needs the stripper run on it)? */
function cachedDataHidesPending(queryKey: readonly unknown[], data: unknown): boolean {
  if (queryKey[1] === "detail") {
    return isBookmarkRecord(data) && (pendingBookmarkIds.has(data.id) ||
      (!!data.folderId && pendingFolderIds.has(data.folderId)) ||
      (pendingTagIds.size > 0 && bookmarkHasPendingTag(data)));
  }
  if (!isPagedBookmarks(data)) return false;
  const rowsPending = pendingBookmarkIds.size > 0 || pendingFolderIds.size > 0;
  const tagsPending = pendingTagIds.size > 0;
  if (!rowsPending && !tagsPending) return false;
  for (const page of data.pages) {
    if (!page || !Array.isArray(page.items)) continue;
    for (const item of page.items) {
      if (rowsPending && (pendingBookmarkIds.has(item.id) || (item.folderId != null && pendingFolderIds.has(item.folderId)))) return true;
      if (tagsPending && bookmarkHasPendingTag(item)) return true;
    }
  }
  return false;
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

interface WindowWatch {
  /** Bookmark list/detail queries present when the undo window opened, keyed by
   * query hash. `updates` is the state's dataUpdateCount at that moment, so
   * queries created or refetched behind the tombstones are detectable. */
  bookmarks: Map<string, { updates: number; catalogue: boolean }>;
  tags: Map<string, number>;
}

/** Recorded after the optimistic hide: our own writes are part of the
 * baseline, and anything that changes afterwards happened inside the window. */
function watchBookmarkWindow(): WindowWatch {
  const bookmarks = new Map<string, { updates: number; catalogue: boolean }>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    // Details fetched during a tag-deletion window can also be stripped and
    // are not covered by the hide-time assignment snapshot.
    if (!isPagedBookmarks(query.state.data) && query.queryKey[1] !== "detail") continue;
    bookmarks.set(query.queryHash, { updates: query.state.dataUpdateCount, catalogue: query.queryKey[1] === "library-index" });
  }
  const tags = new Map<string, number>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: tagsAnyAccess })) {
    tags.set(query.queryHash, query.state.dataUpdateCount);
  }
  return { bookmarks, tags };
}

/** Queries created/refetched during the undo window can sit outside the hide
 * membership snapshot (a search started mid-window) or hold rows the stripper
 * stripped. Diff them BEFORE restoring: the restore's own writes would
 * otherwise mask the change. Catalogue changes are staled, never replayed —
 * refetching them would page through the whole library again. */
function diffWindowBookmarkQueries(watch: WindowWatch): { refetch: Set<string>; staleOnly: Set<string>; tags: Set<string> } {
  const refetch = new Set<string>();
  const staleOnly = new Set<string>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    if (!isPagedBookmarks(query.state.data) && query.queryKey[1] !== "detail") continue;
    const before = watch.bookmarks.get(query.queryHash);
    if (before && before.updates === query.state.dataUpdateCount && !query.state.isInvalidated) continue;
    if ((before?.catalogue ?? false) || query.queryKey[1] === "library-index") staleOnly.add(query.queryHash);
    else refetch.add(query.queryHash);
  }
  const tags = new Set<string>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: tagsAnyAccess })) {
    const before = watch.tags.get(query.queryHash);
    if (before !== undefined && before === query.state.dataUpdateCount && !query.state.isInvalidated) continue;
    tags.add(query.queryHash);
  }
  return { refetch, staleOnly, tags };
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

interface HideGroup {
  bookmarks: readonly BookmarkDto[];
  bumpCounts: boolean;
  /** Kept bookmarks ride along for membership/restore only: the folder's
   * tombstone hides them, but they are never journal-tombstoned or counted. */
  tombstone?: boolean;
}

/** Hide several bookmark groups with ONE membership walk and ONE cache sweep.
 * Two passes (contained + standalone) rewrote every paged query — including
 * the whole library catalogue — twice per delete, and the dispatch cascade
 * (replaceEqualDeep + subscribers) dominated the confirm-press latency. */
function hideBookmarks(groups: readonly HideGroup[]): BookmarkRestore {
  const details = new Map<string, BookmarkDetailDto | BookmarkDto>();
  const lists = new Map<string, (readonly unknown[])[]>();
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.tombstone === false) continue;
    for (const bookmark of group.bookmarks) ids.add(bookmark.id);
  }
  const tracked = new Set<string>();
  for (const group of groups) for (const bookmark of group.bookmarks) tracked.add(bookmark.id);
  if (tracked.size === 0) return { details, lists };
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    const data = query.state.data;
    if (!isPagedBookmarks(data)) continue;
    for (const page of data.pages) {
      if (!page || !Array.isArray(page.items)) continue;
      for (const item of page.items) {
        if (!tracked.has(item.id)) continue;
        lists.set(item.id, [...(lists.get(item.id) ?? []), query.queryKey]);
      }
    }
  }
  const cancelReminderIds: string[] = [];
  for (const group of groups) {
    for (const bookmark of group.bookmarks) {
      const detail = queryClient.getQueryData<BookmarkDetailDto | BookmarkDto>(qk.bookmark(bookmark.id));
      if (detail) details.set(bookmark.id, detail);
      if (group.tombstone === false) continue;
      pendingBookmarkIds.add(bookmark.id);
      if (bookmark.remindAt != null) cancelReminderIds.push(bookmark.id);
    }
  }
  if (cancelReminderIds.length > 0) {
    void import("./reminder-notifications").then(({ cancelBookmarkReminder }) => {
      for (const id of cancelReminderIds) cancelBookmarkReminder(id);
    });
  }
  // Kept rows also leave their old folder during the window. They have no
  // bookmark tombstone, but the pending folder suppresses refetched copies.
  removeBookmarksEverywhere(queryClient, tracked);
  removeRemindersFromCache(queryClient, ids);
  queryClient.removeQueries({ queryKey: ["bookmarks", "detail"], predicate: (query) => ids.has(String(query.queryKey[2])) });
  for (const group of groups) {
    if (group.bumpCounts) moveFolderCounts(queryClient, group.bookmarks, null);
  }
  return { details, lists };
}

function restoreBookmarks(
  groups: readonly { bookmarks: readonly BookmarkDto[]; snapshot: BookmarkRestore; bumpCounts: boolean }[],
) {
  const bookmarks = groups.flatMap((group) => group.bookmarks);
  if (bookmarks.length === 0) return new Set<string>();
  for (const bookmark of bookmarks) pendingBookmarkIds.delete(bookmark.id);
  const memberships = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const [id, keys] of group.snapshot.lists) {
      for (const key of keys) {
        const hash = JSON.stringify(key);
        const ids = memberships.get(hash) ?? new Set<string>();
        ids.add(id); memberships.set(hash, ids);
      }
    }
  }
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks"] })) {
    if (!isPagedBookmarks(query.state.data)) continue;
    const previouslyPresent = memberships.get(JSON.stringify(query.queryKey));
    const incoming = bookmarks.filter((bookmark) => previouslyPresent?.has(bookmark.id) || listKeyAllowsRestore(query.queryKey, bookmark.folderId));
    if (incoming.length) insertBookmarksIfAbsent(queryClient, query.queryKey, incoming);
  }
  for (const group of groups) {
    if (group.bumpCounts) moveFolderCounts(queryClient, group.bookmarks, null, -1);
  }
  syncRemindersInCache(queryClient, bookmarks.filter((bookmark) => bookmark.remindAt != null));
  const restoredDetails = new Set<string>();
  for (const group of groups) {
    for (const bookmark of group.bookmarks) {
      const detail = group.snapshot.details.get(bookmark.id);
      if (detail) {
        queryClient.setQueryData(qk.bookmark(bookmark.id), detail);
        restoredDetails.add(bookmark.id);
      }
    }
  }
  const reminders = bookmarks.filter((bookmark) => bookmark.remindAt != null);
  if (reminders.length > 0) {
    void import("./reminder-notifications").then(({ syncBookmarkReminder }) => {
      for (const bookmark of reminders) syncBookmarkReminder(bookmark);
    });
  }
  return restoredDetails;
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
  /** Bookmark ids (inside the deleted folders) to move to the unfiled root
   * when the deletion commits, instead of cascading away with the folder. */
  keepIds?: readonly string[];
  onDeleted?: () => void;
  showToast?: boolean;
}

function releaseIntent(intent: DeleteIntent) {
  for (const bookmark of intent.bookmarks) pendingBookmarkIds.delete(bookmark.id);
  for (const id of intent.contained) pendingBookmarkIds.delete(id);
  for (const id of intent.folders) pendingFolderIds.delete(id);
  for (const id of intent.tags) pendingTagIds.delete(id);
}

function invalidateDeletedLists(includeCatalogue = false) {
  void queryClient.invalidateQueries({
    queryKey: ["bookmarks"],
    // The catalogue is paged through the whole library; invalidating it
    // refetches every loaded page sequentially after each delete. Deleted
    // rows were already tombstoned out of it, and search recompiles from the
    // refreshed list/detail copies (same policy as extraction polls).
    predicate: (query) => includeCatalogue || query.queryKey[1] !== "library-index",
  });
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

async function replayDeleteIntent(key: string, intent: DeleteIntent, keptRows: readonly BookmarkDto[] = []) {
  const owner = captureSessionScope();
  const keepIds = new Set((intent.keeps ?? []).map((row) => row.id));
  const knownKeeps = new Map([...keptRows, ...(keepIds.size ? collectCachedBookmarks(queryClient) : [])]
    .filter((row) => keepIds.has(row.id)).map((row) => [row.id, row]));
  const missingKeeps = new Set<string>();
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
  // Kept bookmarks must leave the folder before it cascades away. Grouping by
  // folder keeps the unlock header pointing at each bookmark's source, and the
  // move is idempotent when a replay resumes after process death.
  const keepsByFolder = new Map<string, string[]>();
  for (const keep of intent.keeps ?? []) {
    const ids = keepsByFolder.get(keep.folderId) ?? [];
    if (!ids.includes(keep.id)) ids.push(keep.id);
    keepsByFolder.set(keep.folderId, ids);
  }
  for (const [sourceFolderId, ids] of keepsByFolder) {
    await removeChunks(ids,
      async (chunk) => {
        const result = await bookmarksApi.batch({ action: "move", ids: chunk, folderId: null }, { folderId: sourceFolderId });
        if (result.updated < chunk.length) {
          // Reuse the idempotent single-row fallback before allowing a folder
          // cascade: a count alone cannot tell us which keeps actually moved.
          throw Object.assign(new Error("Some kept bookmarks need reconciliation."), { status: 404 });
        }
      },
      async (id) => {
        try {
          const updated = await bookmarksApi.update(id, { folderId: null }, { folderId: sourceFolderId });
          if (isBookmarkRecord(updated)) knownKeeps.set(id, updated);
        } catch (cause) {
          if ((cause as { status?: number }).status === 404) {
            knownKeeps.delete(id); missingKeeps.add(id);
          }
          throw cause;
        }
      });
  }
  await removeChunks(intent.folders, (ids) => foldersApi.batch({ action: "delete", ids }), (id) => foldersApi.remove(id));
  for (const id of intent.tags) {
    assertScope();
    await deleteIfPresent(() => tagsApi.remove(id));
  }
  assertScope();
  // A response captured before DELETE must not resurrect rows/tags after their
  // tombstones are released. Cancellation also handles queryFns ignoring abort.
  const initialCatalogueFetches = new Set(queryClient.getQueryCache().findAll({ queryKey: ["bookmarks", "library-index"] })
    .filter((query) => query.state.data === undefined && query.state.fetchStatus === "fetching").map((query) => query.queryHash));
  await queryClient.cancelQueries({ queryKey: ["bookmarks", "library-index"] });
  assertScope();
  forgetDeleteIntent(key, intent.id);
  if (deleteJournalKey() !== key) return;
  releaseIntent(intent);
  if (missingKeeps.size > 0) {
    removeBookmarksEverywhere(queryClient, missingKeeps);
    removeRemindersFromCache(queryClient, missingKeeps);
    queryClient.removeQueries({ queryKey: ["bookmarks", "detail"], predicate: (query) => missingKeeps.has(String(query.queryKey[2])) });
  }
  const movedKeeps = [...knownKeeps.values()].map((row) => ({ ...row, folderId: null }));
  moveBookmarksInCache(queryClient, movedKeeps);
  if (movedKeeps.length > 0) {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["bookmarks", "library-index"] })) {
      if (isPagedBookmarks(query.state.data)) insertBookmarksIfAbsent(queryClient, query.queryKey, movedKeeps);
    }
  }
  for (const id of intent.folders) useFolderTokenStore.getState().clear(id);
  // A resumed ID-only journal may lack metadata for an uncached kept row.
  // Only that exceptional case needs a full catalogue reconciliation.
  invalidateDeletedLists(knownKeeps.size < keepIds.size);
  // Cancelling a first warm fetch has no cached pages for the paced loop to
  // resume. Restart only that first page, not any already-warmed catalogue.
  if (initialCatalogueFetches.size > 0) void queryClient.refetchQueries({
    queryKey: ["bookmarks", "library-index"], type: "active",
    predicate: (query) => initialCatalogueFetches.has(query.queryHash),
  });
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
          invalidateDeletedLists(true);
        }
        toast.error(status && status >= 400 && status < 500 ? errorMessage(cause)
          : `${errorMessage(cause)} Deletion will retry when you return online.`);
      }).finally(() => activeIntents.delete(activeKey));
    }
    // The disk cache may already contain these rows. Apply tombstones now,
    // rather than waiting for a network/cache event to trigger the subscriber.
    // Rewriting every query republished the whole cache (catalogue included)
    // and scheduled a full disk snapshot; only dirty queries need the write.
    for (const query of queryClient.getQueryCache().getAll()) {
      const queryKey = query.queryKey;
      const data = query.state.data;
      if (data === undefined) continue;
      const scope = String(queryKey[0]);
      if (scope === "folders") {
        if (pendingFolderIds.size > 0 && Array.isArray(data) && data.some((row) => pendingFolderIds.has(row.id))) {
          queryClient.setQueryData(queryKey, data);
        }
      } else if (scope === "tags") {
        if (pendingTagIds.size > 0 && Array.isArray(data) && data.some((row) => pendingTagIds.has(row.id))) {
          queryClient.setQueryData(queryKey, data);
        }
      } else if (scope === "bookmarks" && queryKey[1] !== "extraction-progress") {
        if (cachedDataHidesPending(queryKey, data)) queryClient.setQueryData(queryKey, data);
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
  const standaloneIds = new Set(standalone.map((bookmark) => bookmark.id));
  const contained = collectBookmarksInFolders(folderIds).filter(
    (bookmark) => !pendingBookmarkIds.has(bookmark.id) && !standaloneIds.has(bookmark.id),
  );
  // Ticked bookmarks leave the folder at commit time instead of cascading.
  // They are never tombstoned: the folder's tombstone already hides them, so
  // undo restores them in place and commit surfaces them in Bookmarks.
  const keepIdSet = new Set(opts.keepIds ?? []);
  const singleFolderId = folders.length === 1 ? folders[0]!.id : null;
  const keeps = (opts.keepIds ?? [])
    .map((id) => ({ id, folderId: singleFolderId ?? contained.find((b) => b.id === id)?.folderId ?? null }))
    .filter((keep): keep is { id: string; folderId: string } =>
      keep.folderId !== null && folderIds.has(keep.folderId));
  const deletableContained = contained.filter((bookmark) => !keepIdSet.has(bookmark.id));

  let journal: ReturnType<typeof recordDeleteIntent>;
  try {
    journal = recordDeleteIntent({
      bookmarks: standalone.map(({ id, folderId }) => ({ id, folderId })),
      folders: folders.map((folder) => folder.id), tags: tags.map((tag) => tag.id),
      contained: deletableContained.map((bookmark) => bookmark.id),
      ...(keeps.length > 0 ? { keeps } : {}),
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
  // One membership walk + one cache sweep for contained and standalone rows.
  // Kept bookmarks ride along so Undo can put them back without a refetch.
  const keepRows = contained.filter((bookmark) => keepIdSet.has(bookmark.id));
  const restoreGroups: { bookmarks: readonly BookmarkDto[]; snapshot: BookmarkRestore; bumpCounts: boolean }[] = [];
  const hideGroups: HideGroup[] = [
    { bookmarks: deletableContained as readonly BookmarkDto[], bumpCounts: false },
    { bookmarks: standalone as readonly BookmarkDto[], bumpCounts: true },
    ...(keepRows.length > 0 ? [{ bookmarks: keepRows as readonly BookmarkDto[], bumpCounts: false, tombstone: false as const }] : []),
  ].filter((group) => group.bookmarks.length > 0);
  const combined = hideBookmarks(hideGroups);
  for (const group of hideGroups) {
    restoreGroups.push({ bookmarks: group.bookmarks, snapshot: { details: combined.details, lists: combined.lists }, bumpCounts: group.bumpCounts });
  }
  const tagAssignments = hideTags(tags);
  const windowWatch = watchBookmarkWindow();
  opts.onDeleted?.();

  let settled = false;
  const showToast = opts.showToast !== false;

  const restore = () => {
    restoreFolders(folders);
    // Release tag tombstones before re-inserting hidden bookmarks; otherwise
    // the stripper would immediately erase tags from the restored snapshots.
    restoreTags(tags, tagAssignments);
    const restoredDetails = restoreBookmarks(restoreGroups);
    // Mark snapshots stale after all restore sweeps: tag restoration can also
    // write these details, clearing a stale flag set earlier in the batch.
    if (restoredDetails.size > 0) void queryClient.invalidateQueries({
      queryKey: ["bookmarks", "detail"],
      predicate: (query) => restoredDetails.has(String(query.queryKey[2])), refetchType: "none",
    });
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
      const changed = diffWindowBookmarkQueries(windowWatch);
      restore();
      // Untouched lists are restored locally. A query created/refetched during
      // the window may have lost rows/tags outside that snapshot, so reconcile
      // only those queries. Never replay the whole catalogue on the Undo tap.
      if (changed.refetch.size > 0) void queryClient.invalidateQueries({
        queryKey: ["bookmarks"], predicate: (query) => changed.refetch.has(query.queryHash),
      });
      if (changed.staleOnly.size > 0) void queryClient.invalidateQueries({
        queryKey: ["bookmarks"], predicate: (query) => changed.staleOnly.has(query.queryHash), refetchType: "none",
      });
      if (tags.length > 0 && changed.tags.size > 0) void queryClient.invalidateQueries({
        queryKey: tagsAnyAccess, predicate: (query) => changed.tags.has(query.queryHash),
      });
      void queryClient.invalidateQueries({ queryKey: qk.folders });
      return true;
    }
    void replayDeleteIntent(journal.key, journal.intent, keepRows).catch((cause) => {
      if (!isSessionScopeCurrent(owner) || deleteJournalKey() !== journal.key || generation !== scopeGeneration) return;
      const status = (cause as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        try { forgetDeleteIntent(journal.key, journal.intent.id); } catch (storageError) {
          toast.error(errorMessage(storageError, "Couldn't save deletion status."));
          return;
        }
        restore();
        invalidateDeletedLists(true);
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
