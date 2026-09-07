/** Shared user-facing phrases used in more than one screen. */
import type { ImportResultDto, TagDto } from "@ordo/shared";

export function markedAsReadToast(count: number): string {
  return count === 1 ? "1 bookmark marked as read" : `${count} bookmarks marked as read`;
}

export function markedAsUnreadToast(count: number): string {
  return count === 1 ? "1 bookmark marked as unread" : `${count} bookmarks marked as unread`;
}

export function deletedBookmarksToast(count: number): string {
  return count === 1 ? "Bookmark deleted" : `${count} bookmarks deleted`;
}

export function deletedFoldersToast(count: number): string {
  return count === 1 ? "Folder deleted" : `${count} folders deleted`;
}

export function deletedTagsToast(tags: readonly Pick<TagDto, "name" | "bookmarkCount">[]): string {
  if (tags.length === 1) {
    const tag = tags[0];
    return tag.bookmarkCount > 0
      ? `Deleted "${tag.name}" and its ${tag.bookmarkCount} assignments`
      : `Deleted "${tag.name}"`;
  }
  return `${tags.length} tags deleted`;
}

export function movedBookmarksToast(count: number, folderName: string): string {
  return count === 1 ? `Moved to ${folderName}` : `Moved ${count} bookmarks to ${folderName}`;
}

export function addedTagsToast(bookmarkCount: number): string {
  return bookmarkCount === 1 ? "Tags updated" : `Tags added to ${bookmarkCount} bookmarks`;
}

export function importedToast(result: ImportResultDto): string {
  if (result.imported === 0 && result.updated === 0) {
    return result.skipped > 0 ? "Everything in that file was already saved" : "Nothing to import";
  }
  const parts: string[] = [];
  if (result.imported > 0) {
    parts.push(result.imported === 1 ? "1 bookmark imported" : `${result.imported} bookmarks imported`);
  }
  if (result.updated > 0) {
    parts.push(result.updated === 1 ? "1 updated" : `${result.updated} updated`);
  }
  if (result.skipped > 0) {
    parts.push(result.skipped === 1 ? "1 already saved" : `${result.skipped} already saved`);
  }
  return parts.join(" · ");
}
