/**
 * Session-only list order menu. Home offers folder + bookmark pages;
 * a folder list is bookmark order only.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BookmarkListSort } from "@ordo/shared";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import {
  BOOKMARK_SORT_LABEL,
  FOLDER_SORT_LABEL,
  type FolderListSort,
} from "../../lib/list-sort";

const BOOKMARK_SORTS: readonly BookmarkListSort[] = ["newest", "oldest", "title", "titleDesc"];
const FOLDER_SORTS: readonly FolderListSort[] = ["name", "newest", "oldest"];

const BOOKMARK_SORT_ICON: Record<BookmarkListSort, keyof typeof Ionicons.glyphMap> = {
  newest: "time-outline",
  oldest: "hourglass-outline",
  title: "swap-vertical-outline",
  titleDesc: "swap-vertical-outline",
};

const FOLDER_SORT_ICON: Record<FolderListSort, keyof typeof Ionicons.glyphMap> = {
  name: "list-outline",
  newest: "time-outline",
  oldest: "hourglass-outline",
};

type Page = "root" | "folders" | "bookmarks";

export function SortMenu({
  visible,
  onDismiss,
  anchor,
  variant,
  folderSort,
  bookmarkSort,
  onFolderSort,
  onBookmarkSort,
}: {
  visible: boolean;
  onDismiss: () => void;
  anchor: MenuAnchorRect | null;
  variant: "home" | "bookmarks";
  folderSort?: FolderListSort;
  bookmarkSort: BookmarkListSort;
  onFolderSort?: (sort: FolderListSort) => void;
  onBookmarkSort: (sort: BookmarkListSort) => void;
}) {
  const [page, setPage] = useState<Page>(variant === "home" ? "root" : "bookmarks");

  useEffect(() => {
    if (!visible) setPage(variant === "home" ? "root" : "bookmarks");
  }, [visible, variant]);

  const pickFolder = (sort: FolderListSort) => {
    onFolderSort?.(sort);
    onDismiss();
  };
  const pickBookmark = (sort: BookmarkListSort) => {
    onBookmarkSort(sort);
    onDismiss();
  };

  return (
    <ContextMenu visible={visible} onDismiss={onDismiss} anchor={anchor}>
      {page === "root" && folderSort ? (
        <>
          <ContextMenuItem
            icon="folder-outline"
            label="Sort folders"
            trailing={<Trailing label={FOLDER_SORT_LABEL[folderSort]} />}
            onPress={() => setPage("folders")}
          />
          <ContextMenuItem
            icon="bookmark-outline"
            label="Sort bookmarks"
            trailing={<Trailing label={BOOKMARK_SORT_LABEL[bookmarkSort]} />}
            onPress={() => setPage("bookmarks")}
          />
        </>
      ) : null}
      {page === "folders" && folderSort ? (
        <>
          {variant === "home" ? (
            <ContextMenuItem icon="chevron-back" label="Back" onPress={() => setPage("root")} />
          ) : null}
          {FOLDER_SORTS.map((sort) => (
            <ContextMenuItem
              key={sort}
              icon={FOLDER_SORT_ICON[sort]}
              label={FOLDER_SORT_LABEL[sort]}
              selected={folderSort === sort}
              onPress={() => pickFolder(sort)}
            />
          ))}
        </>
      ) : null}
      {page === "bookmarks" ? (
        <>
          {variant === "home" ? (
            <ContextMenuItem icon="chevron-back" label="Back" onPress={() => setPage("root")} />
          ) : null}
          {BOOKMARK_SORTS.map((sort) => (
            <ContextMenuItem
              key={sort}
              icon={BOOKMARK_SORT_ICON[sort]}
              label={BOOKMARK_SORT_LABEL[sort]}
              selected={bookmarkSort === sort}
              onPress={() => pickBookmark(sort)}
            />
          ))}
        </>
      ) : null}
    </ContextMenu>
  );
}

function Trailing({ label }: { label: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.trailing}>
      <Text variant="caption" color="tertiary" numberOfLines={1} style={styles.trailingLabel}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={palette.textFaint} />
    </View>
  );
}

const styles = StyleSheet.create({
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    flexShrink: 0,
    maxWidth: 120,
  },
  trailingLabel: { flexShrink: 1 },
});
