import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import type { BookmarkDto } from "@ordo/shared";
import { useTheme } from "../theme/ThemeProvider";
import { estimateBookmarkRowSize, FOLDER_ROW_SIZE, listRowLayouts } from "../lib/bookmark-row-layout";

export function useBookmarkListLayout(bookmarks: readonly BookmarkDto[], folderCount = 0, omitTagIds?: readonly string[]) {
  const { expressive } = useTheme();
  const { fontScale } = useWindowDimensions();
  return useMemo(() => {
    // Fixed geometry must never clip accessibility-sized text.
    if (fontScale > 1) return undefined;
    const gap = expressive ? 2 : 0;
    const rows = listRowLayouts([
      ...Array.from({ length: folderCount }, () => FOLDER_ROW_SIZE + gap),
      ...bookmarks.map((bookmark) => estimateBookmarkRowSize(bookmark, omitTagIds) + gap),
    ]);
    return (_data: unknown, index: number) => rows[index]!;
  }, [bookmarks, folderCount, omitTagIds, expressive, fontScale]);
}
