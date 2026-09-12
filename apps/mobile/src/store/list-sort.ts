/**
 * Session-only list order. Lost on restart; never written to the account.
 */
import { create } from "zustand";
import { DEFAULT_BOOKMARK_LIST_SORT, type BookmarkListSort } from "@ordo/shared";
import { DEFAULT_FOLDER_LIST_SORT, type FolderListSort } from "../lib/list-sort";

export interface ListSortState {
  folderSort: FolderListSort;
  unfiledSort: BookmarkListSort;
  folderBookmarkSorts: Record<string, BookmarkListSort>;
  setFolderSort: (sort: FolderListSort) => void;
  setUnfiledSort: (sort: BookmarkListSort) => void;
  setFolderBookmarkSort: (folderId: string, sort: BookmarkListSort) => void;
  bookmarkSort: (folderId: string | null) => BookmarkListSort;
}

export const useListSortStore = create<ListSortState>((set, get) => ({
  folderSort: DEFAULT_FOLDER_LIST_SORT,
  unfiledSort: DEFAULT_BOOKMARK_LIST_SORT,
  folderBookmarkSorts: {},

  setFolderSort: (folderSort) => set({ folderSort }),
  setUnfiledSort: (unfiledSort) => set({ unfiledSort }),
  setFolderBookmarkSort: (folderId, sort) =>
    set((state) => ({
      folderBookmarkSorts: { ...state.folderBookmarkSorts, [folderId]: sort },
    })),
  bookmarkSort: (folderId) => {
    if (!folderId) return get().unfiledSort;
    return get().folderBookmarkSorts[folderId] ?? DEFAULT_BOOKMARK_LIST_SORT;
  },
}));
