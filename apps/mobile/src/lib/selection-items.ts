import type { BookmarkDto, FolderDto } from "@ordo/shared";
import type { SelectionKey } from "./selection-state";

export function indexSelectionItems(bookmarks: readonly BookmarkDto[], folders: readonly FolderDto[]) {
  return {
    bookmarks: new Map(bookmarks.map(item => [`bookmark:${item.id}` as SelectionKey, item])),
    folders: new Map(folders.map(item => [`folder:${item.id}` as SelectionKey, item])),
  };
}
type SelectionItems = ReturnType<typeof indexSelectionItems>;

/** Only capabilities subscribe during a drag, not arrays of DTOs or dialog data. */
export function selectionCapabilities(ids: ReadonlySet<SelectionKey>, items: SelectionItems) {
  let bookmarks = false, folders = false, allRead = true, allPinned = true;
  for (const key of ids) {
    const bookmark = items.bookmarks.get(key);
    if (bookmark) { bookmarks = true; allRead &&= bookmark.isRead; }
    const folder = items.folders.get(key);
    if (folder) { folders = true; allPinned &&= folder.pinned; }
    if (bookmarks && folders) break;
  }
  return { empty: !bookmarks && !folders, bookmarksOnly: bookmarks && !folders,
    foldersOnly: folders && !bookmarks, allRead: bookmarks && !folders && allRead,
    allPinned: folders && !bookmarks && allPinned };
}

/** Materialize the current selection only when an action is invoked. */
export function selectedItems(ids: ReadonlySet<SelectionKey>, items: SelectionItems) {
  const bookmarks: BookmarkDto[] = [], folders: FolderDto[] = [];
  for (const key of ids) {
    const bookmark = items.bookmarks.get(key);
    if (bookmark) bookmarks.push(bookmark);
    const folder = items.folders.get(key);
    if (folder) folders.push(folder);
  }
  return { bookmarks, folders };
}
