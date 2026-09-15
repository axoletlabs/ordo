/**
 * Bookmark/folder row height math. Kept for tests and any layout that still
 * needs an estimate; lists size rows from content.
 */
import type { BookmarkDto } from "@ordo/shared";

export const FOLDER_ROW_SIZE = 72;
export const BOOKMARK_ROW_BASE_SIZE = 72;

function bookmarkRowFlags(bookmark: BookmarkDto | null | undefined) {
  const isArticle = !!bookmark && (bookmark.contentKind === "article" || bookmark.fetchStatus === "ok");
  return {
    isArticle,
    hasDescription: isArticle && !!bookmark?.description,
    hasTags: !!bookmark && Array.isArray(bookmark.tags) && bookmark.tags.length > 0,
    hasSuggestions:
      !!bookmark && Array.isArray(bookmark.suggestedTags) && bookmark.suggestedTags.length > 0,
  };
}

/**
 * FlashList recycling pool. Compact website rows and tagged articles do not
 * share an average height — mixing them is how a delete leaves blank gaps.
 */
export function bookmarkListItemType(bookmark: BookmarkDto | null | undefined): string {
  if (!bookmark) return "bookmark";
  const { hasDescription, hasTags, hasSuggestions } = bookmarkRowFlags(bookmark);
  if (hasDescription && hasTags) return "bookmark:article-tags";
  if (hasDescription) return "bookmark:article";
  if (hasTags) return "bookmark:tags";
  if (hasSuggestions) return "bookmark:suggested";
  return "bookmark";
}

export function estimateBookmarkRowSize(bookmark: BookmarkDto | null | undefined): number {
  if (!bookmark) return BOOKMARK_ROW_BASE_SIZE;
  const { hasDescription, hasTags, hasSuggestions } = bookmarkRowFlags(bookmark);
  let size = BOOKMARK_ROW_BASE_SIZE;
  if (hasDescription) size += 18;
  if (hasTags) size += 24;
  if (hasSuggestions) size += 18;
  return size;
}
