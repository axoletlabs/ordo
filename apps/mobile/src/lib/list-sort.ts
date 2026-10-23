/**
 * View-only list order. Session memory only — not persisted, not on the account.
 */
import type { BookmarkDto, BookmarkListSort, FolderDto, TagDto } from "@ordo/shared";
import { flattenPages } from "./api/query-keys";

export const FOLDER_LIST_SORTS = ["name", "newest", "oldest"] as const;
export type FolderListSort = (typeof FOLDER_LIST_SORTS)[number];
export const DEFAULT_FOLDER_LIST_SORT: FolderListSort = "oldest";

// Passing locale options to localeCompare constructs a collator for every
// comparison on Hermes/V8. Reuse one across an O(n log n) library sort.
const titleCollator = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * `Date#toISOString` output, which is fixed-width UTC. For this exact shape
 * byte order is chronological order, so the hot comparator can skip
 * localeCompare. Imported/legacy rows with offsets, a missing millisecond
 * part, or another format take the old localeCompare path byte-for-byte.
 */
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
      return titleCollator.compare(a.name, b.name) || a.id.localeCompare(b.id);
    }
    if (sort === "newest") {
      return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    }
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

/** Default folder order when no explicit sort is selected: pinned first, then oldest → newest. */
export function sortFoldersDefault(folders: readonly FolderDto[]): FolderDto[] {
  return [...folders].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt),
  );
}

/** Default tag order: most used first, then name. */
export function sortTagsDefault(tags: readonly TagDto[]): TagDto[] {
  return [...tags].sort(
    (a, b) => b.bookmarkCount - a.bookmarkCount || a.name.localeCompare(b.name),
  );
}

function compareCanonicalTimestamp(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortBookmarksInPlace(
  bookmarks: BookmarkDto[],
  sort: BookmarkListSort,
): BookmarkDto[] {
  if (sort === "title" || sort === "titleDesc") {
    bookmarks.sort((a, b) => {
      const cmp =
        titleCollator.compare(a.title, b.title) ||
        a.id.localeCompare(b.id);
      return sort === "title" ? cmp : -cmp;
    });
    return bookmarks;
  }
  // Decide once per list instead of testing both timestamps on every
  // comparison. One legacy timestamp switches the whole list back to the
  // existing localeCompare order.
  const canonicalDates = bookmarks.every((bookmark) => CANONICAL_ISO.test(bookmark.createdAt));
  bookmarks.sort((a, b) => {
    const cmp = canonicalDates
      ? compareCanonicalTimestamp(a.createdAt, b.createdAt)
      : a.createdAt.localeCompare(b.createdAt);
    const ordered = cmp || a.id.localeCompare(b.id);
    return sort === "oldest" ? ordered : -ordered;
  });
  return bookmarks;
}

/** Reorder loaded bookmarks to match the selected sort (case-insensitive titles). */
export function sortBookmarksBy(
  bookmarks: readonly BookmarkDto[],
  sort: BookmarkListSort,
): BookmarkDto[] {
  return sortBookmarksInPlace([...bookmarks], sort);
}

/**
 * Flatten cursor pages once and order the fresh row array in place.
 *
 * Screens previously did `sortBookmarksBy(flattenPages(pages), sort)`, which
 * copied every loaded row a second time before sorting. The returned array is
 * new, so in-place sorting never mutates the query cache or page arrays, and
 * `flattenPages` keeps its first-id-wins dedupe and id-less fallback.
 */
export function sortBookmarkPagesBy(
  pages: readonly { items: readonly BookmarkDto[] }[],
  sort: BookmarkListSort,
): BookmarkDto[] {
  return sortBookmarksInPlace(flattenPages(pages), sort);
}
