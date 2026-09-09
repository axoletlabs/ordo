/**
 * FlashList size hints. An overestimate leaves blank gaps between rows;
 * these match BookmarkRow / FolderRow padding.
 */
import type { BookmarkDto } from "@ordo/shared";

export const FOLDER_ROW_SIZE = 72;
export const BOOKMARK_ROW_BASE_SIZE = 72;

export function estimateBookmarkRowSize(bookmark: BookmarkDto | null | undefined): number {
  if (!bookmark) return BOOKMARK_ROW_BASE_SIZE;
  let size = BOOKMARK_ROW_BASE_SIZE;
  const isArticle = bookmark.contentKind === "article" || bookmark.fetchStatus === "ok";
  if (isArticle && bookmark.description) size += 18;
  if (Array.isArray(bookmark.tags) && bookmark.tags.length > 0) size += 24;
  if (Array.isArray(bookmark.suggestedTags) && bookmark.suggestedTags.length > 0) size += 18;
  return size;
}
