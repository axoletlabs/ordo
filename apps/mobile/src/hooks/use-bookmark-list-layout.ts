import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import type { BookmarkDto } from "@ordo/shared";
import { useTheme } from "../theme/ThemeProvider";
import { estimateBookmarkRowSize, FOLDER_ROW_SIZE, lazyListRowLayout } from "../lib/bookmark-row-layout";

export function useBookmarkListLayout(bookmarks: readonly BookmarkDto[], folderCount = 0, omitTagIds?: readonly string[]) {
  const { expressive } = useTheme();
  const { fontScale } = useWindowDimensions();
  return useMemo(() => {
    // Fixed geometry must never clip accessibility-sized text.
    if (fontScale > 1) return undefined;
    const gap = expressive ? 2 : 0;
    // Navigation paints its shell before the list asks for geometry. Cache
    // only the needed prefix instead of allocating offsets for every loaded page.
    return lazyListRowLayout(folderCount + bookmarks.length, (index) =>
      (index < folderCount ? FOLDER_ROW_SIZE : estimateBookmarkRowSize(bookmarks[index - folderCount], omitTagIds)) + gap);
  }, [bookmarks, folderCount, omitTagIds, expressive, fontScale]);
}
