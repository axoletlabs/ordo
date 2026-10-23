/**
 * Shared row geometry. Standard font sizes use exact layout offsets, avoiding
 * per-cell native/web measurements. Scaled accessibility text remains intrinsic.
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

export function estimateBookmarkRowSize(bookmark: BookmarkDto | null | undefined, omitTagIds?: readonly string[]): number {
  if (!bookmark) return BOOKMARK_ROW_BASE_SIZE;
  const hasTags = bookmark.tags?.some((tag) => !omitTagIds?.includes(tag.id));
  // Inline tags are M3 chips (32dp container) with 48dp touch targets whose
  // hitSlop bands live inside the row's own gap and bottom padding, so they
  // cost no extra layout height. Title (24) + metadata (18) + gap (4) +
  // chip (32) + padding (24) = 102; 104 keeps the 8dp grid.
  if (hasTags) return 104;
  return bookmark.remindAt != null || bookmark.suggestedTags?.length ? 96 : BOOKMARK_ROW_BASE_SIZE;
}

export function lazyListRowLayout(count: number, getHeight: (index: number) => number) {
  const rows: { length: number; offset: number; index: number }[] = [];
  let offset = 0;
  return (_data: unknown, index: number) => {
    while (rows.length <= index && rows.length < count) {
      const length = getHeight(rows.length);
      rows.push({ length, offset, index: rows.length });
      offset += length;
    }
    return rows[index]!;
  };
}
