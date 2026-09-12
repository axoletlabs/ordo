/**
 * View-only list order. Session memory only — not persisted, not on the account.
 */
import type { BookmarkListSort, FolderDto } from "@ordo/shared";

export const FOLDER_LIST_SORTS = ["name", "newest", "oldest"] as const;
export type FolderListSort = (typeof FOLDER_LIST_SORTS)[number];
export const DEFAULT_FOLDER_LIST_SORT: FolderListSort = "oldest";

export const BOOKMARK_SORT_LABEL: Record<BookmarkListSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  title: "A–Z",
  titleDesc: "Z–A",
};

export const FOLDER_SORT_LABEL: Record<FolderListSort, string> = {
  name: "Name",
  newest: "Newest",
  oldest: "Oldest",
};

export function sortFoldersBy(folders: readonly FolderDto[], sort: FolderListSort): FolderDto[] {
  return [...folders].sort((a, b) => {
    const pinned = Number(b.pinned) - Number(a.pinned);
    if (pinned) return pinned;
    if (sort === "name") {
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
    }
    if (sort === "newest") {
      return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    }
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}
