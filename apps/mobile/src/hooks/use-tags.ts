/**
 * Tag queries + mutations, plus tag-filtered bookmark lists. Tag catalogue
 * cache keys include the folder-token access revision so unlocking (or expiry
 * of) a protected folder refetches counts that span the whole library.
 */
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSessionMutation as useMutation } from "./use-session-mutation";
import { LIST_PAGE_SIZE } from "../lib/list-pagination";
import { sortTagsDefault } from "../lib/list-sort";
import { type BookmarkDto, type TagColor, type TagDto, type TagSummaryDto } from "@ordo/shared";
import { tagsApi } from "../lib/api/tags";
import { queryClient } from "../lib/query-client";
import { nextPageCursor, qk, tagsAnyAccess } from "../lib/api/query-keys";
import { bookmarksApi } from "../lib/api/bookmarks";
import { useFolderTokenStore } from "../store/folder-tokens";
import { mapCachedBookmarks, updateBookmarkEverywhere } from "../lib/cache-helpers";
import { deleteUndoable } from "../lib/undoable-delete";

function sortTags(tags: TagDto[]) {
  return sortTagsDefault(tags);
}

export function useTags() {
  const accessRevision = useFolderTokenStore((s) => s.accessRevision);
  return useQuery({
    queryKey: qk.tags(accessRevision),
    queryFn: async () => sortTags(await tagsApi.list()),
    staleTime: 30_000,
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color?: TagColor }) =>
      tagsApi.create(input.name, input.color),
    onSuccess: (tag) => {
      // Insert into every cached catalogue regardless of access revision.
      qc.setQueriesData<TagDto[]>({ queryKey: tagsAnyAccess }, (old) =>
        old ? sortTags([...old.filter((t) => t.id !== tag.id), tag]) : old,
      );
    },
  });
}

export interface TagUpdateInput {
  id: string;
  input: { name?: string; color?: TagColor };
}

function mapBookmarkTags(bookmark: BookmarkDto, mapper: (tag: TagSummaryDto) => TagSummaryDto) {
  const tags = bookmark.tags.map(mapper);
  const suggestedTags = bookmark.suggestedTags.map(mapper);
  return tags.some((tag, i) => tag !== bookmark.tags[i]) ||
    suggestedTags.some((tag, i) => tag !== bookmark.suggestedTags[i])
    ? { ...bookmark, tags, suggestedTags }
    : bookmark;
}

function updateTagInBookmarks(qc: QueryClient, id: string, input: TagUpdateInput["input"]) {
  mapCachedBookmarks(qc, (bookmark) => mapBookmarkTags(bookmark, (tag) =>
    tag.id === id ? { ...tag, ...input } : tag,
  ));
}

/** Undo only fields this mutation still owns, not concurrent bookmark/tag edits. */
function restoreTagFields<T extends TagSummaryDto>(
  tag: T,
  previous: TagSummaryDto | undefined,
  input: TagUpdateInput["input"],
): T {
  if (!previous) return tag;
  return {
    ...tag,
    ...(input.name !== undefined && tag.name === input.name ? { name: previous.name } : {}),
    ...(input.color !== undefined && tag.color === input.color ? { color: previous.color } : {}),
  };
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: TagUpdateInput) => tagsApi.update(id, input),
    onMutate: async ({ id, input }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: tagsAnyAccess }),
        qc.cancelQueries({ queryKey: ["bookmarks"] }),
      ]);
      const prev = qc.getQueriesData<TagDto[]>({ queryKey: tagsAnyAccess });
      const bookmarks = new Map<string, BookmarkDto>();
      qc.setQueriesData<TagDto[]>({ queryKey: tagsAnyAccess }, (old) =>
        old ? old.map((t) => (t.id === id ? { ...t, ...input } : t)) : old,
      );
      mapCachedBookmarks(qc, (b) => {
        const next = mapBookmarkTags(b, (t) => t.id === id ? { ...t, ...input } : t);
        if (next !== b) bookmarks.set(b.id, b);
        return next;
      });
      return { prev, bookmarks };
    },
    onError: (_e, { id, input }, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData<TagDto[]>(key, (current) =>
        current?.map((tag) => tag.id === id
          ? restoreTagFields(tag, data?.find((t) => t.id === id), input)
          : tag),
      ));
      mapCachedBookmarks(qc, (bookmark) => {
        const previous = ctx?.bookmarks.get(bookmark.id);
        const original = [...(previous?.tags ?? []), ...(previous?.suggestedTags ?? [])]
          .find((tag) => tag.id === id);
        return mapBookmarkTags(bookmark, (tag) => tag.id === id
          ? restoreTagFields(tag, original, input)
          : tag);
      });
    },
    onSuccess: (updated, { id }) => {
      qc.setQueriesData<TagDto[]>({ queryKey: tagsAnyAccess }, (old) =>
        old ? sortTags(old.map((t) => (t.id === id ? { ...t, ...updated } : t))) : old,
      );
      updateTagInBookmarks(qc, id, { name: updated.name, color: updated.color });
    },
  });
}

export function useDeleteTag() {
  return {
    mutate: (tag: TagDto, opts?: { onDeleted?: () => void }) =>
      deleteUndoable({ tags: [tag], onDeleted: opts?.onDeleted }),
  };
}

export function prefetchTaggedBookmarks(tagId: string) {
  if (!tagId) return;
  return queryClient.prefetchInfiniteQuery({
    queryKey: qk.tagged([tagId]),
    queryFn: ({ pageParam }) =>
      bookmarksApi.listTagged([tagId], pageParam ?? undefined, LIST_PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
  });
}

/** Whole-library, tag-filtered (AND) bookmark list. */
export function useTaggedBookmarks(tagIds: readonly string[], enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.tagged(tagIds),
    queryFn: ({ pageParam }) =>
      bookmarksApi.listTagged([...tagIds], pageParam ?? undefined, LIST_PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    enabled,
  });
}

/** Replace a bookmark's tags; optimistically mirrors the assignment everywhere. */
export function useUpdateBookmarkTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      tagIds,
      dismissedSuggestionIds = [],
      folderId,
    }: {
      id: string;
      tagIds: string[];
      dismissedSuggestionIds?: string[];
      folderId?: string | null;
    }) => bookmarksApi.updateTags(id, { tagIds, dismissedSuggestionIds }, { folderId }),
    onMutate: ({ id, tagIds, dismissedSuggestionIds }) => {
      const snapshots = qc.getQueriesData({ queryKey: ["bookmarks"] });
      const dismissed = new Set(dismissedSuggestionIds);
      updateBookmarkEverywhere(qc, id, (b) => ({
        ...b,
        tags: tagIds
          .map((tagId) => {
            const known = [...b.tags, ...b.suggestedTags].find((t) => t.id === tagId);
            return known ?? null;
          })
          .filter((t): t is NonNullable<typeof t> => t !== null),
        suggestedTags: b.suggestedTags.filter((t) => !dismissed.has(t.id)),
      }));
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSuccess: (updated) => {
      updateBookmarkEverywhere(qc, updated.id, (b) => ({ ...b, ...updated }));
      void qc.invalidateQueries({ queryKey: tagsAnyAccess });
    },
  });
}
