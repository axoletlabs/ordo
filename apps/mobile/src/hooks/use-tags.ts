/**
 * Tag queries + mutations, plus tag-filtered bookmark lists. Tag catalogue
 * cache keys include the folder-token access revision so unlocking (or expiry
 * of) a protected folder refetches counts that span the whole library.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { DEFAULT_PAGE_SIZE, type TagColor, type TagDto } from "@ordo/shared";
import { tagsApi } from "../lib/api/tags";
import { qk, tagsAnyAccess } from "../lib/api/query-keys";
import { bookmarksApi } from "../lib/api/bookmarks";
import { useFolderTokenStore } from "../store/folder-tokens";
import { mapCachedBookmarks, updateBookmarkEverywhere } from "../lib/cache-helpers";
import { deleteUndoable } from "../lib/undoable-delete";

function sortTags(tags: TagDto[]) {
  return [...tags].sort(
    (a, b) => b.bookmarkCount - a.bookmarkCount || a.name.localeCompare(b.name),
  );
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

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: TagUpdateInput) => tagsApi.update(id, input),
    onMutate: ({ id, input }) => {
      const prev = qc.getQueriesData<TagDto[]>({ queryKey: tagsAnyAccess });
      qc.setQueriesData<TagDto[]>({ queryKey: tagsAnyAccess }, (old) =>
        old ? old.map((t) => (t.id === id ? { ...t, ...input } : t)) : old,
      );
      mapCachedBookmarks(qc, (b) => {
        let changed = false;
        const tags = b.tags.map((t) => {
          if (t.id !== id) return t;
          changed = true;
          return { ...t, ...input };
        });
        const suggestedTags = b.suggestedTags.map((t) => {
          if (t.id !== id) return t;
          changed = true;
          return { ...t, ...input };
        });
        return changed ? { ...b, tags, suggestedTags } : b;
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSuccess: (updated, { id }) => {
      qc.setQueriesData<TagDto[]>({ queryKey: tagsAnyAccess }, (old) =>
        old ? old.map((t) => (t.id === id ? { ...t, ...updated } : t)) : old,
      );
    },
  });
}

export function useDeleteTag() {
  return {
    mutate: (tag: TagDto, opts?: { onDeleted?: () => void }) =>
      deleteUndoable({ tags: [tag], onDeleted: opts?.onDeleted }),
  };
}

/** Whole-library, tag-filtered (AND) bookmark list. */
export function useTaggedBookmarks(tagIds: readonly string[], enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.tagged(tagIds),
    queryFn: ({ pageParam }) =>
      bookmarksApi.listTagged([...tagIds], pageParam ?? undefined, DEFAULT_PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
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
