/** How a paginated bookmark list is ordered. View-only; not stored on the account. */
export const BOOKMARK_LIST_SORTS = ["newest", "oldest", "title", "titleDesc"] as const;
export type BookmarkListSort = (typeof BOOKMARK_LIST_SORTS)[number];
export const DEFAULT_BOOKMARK_LIST_SORT: BookmarkListSort = "newest";

export function isBookmarkListSort(value: unknown): value is BookmarkListSort {
  return (
    value === "newest" || value === "oldest" || value === "title" || value === "titleDesc"
  );
}

export function parseBookmarkListSort(value: unknown): BookmarkListSort {
  return isBookmarkListSort(value) ? value : DEFAULT_BOOKMARK_LIST_SORT;
}
