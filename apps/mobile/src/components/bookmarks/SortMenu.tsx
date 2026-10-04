/**
 * Session-only list order menu. Home offers folder + bookmark pages;
 * a folder list is bookmark order only.
 */
import React from "react";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import type { BookmarkListSort } from "@ordo/shared";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { useOverlaySessionMode } from "../../lib/overlay-session-mode";
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
  embedded = false,
  onBack,
  onPageChange,
}: {
  visible: boolean;
  onDismiss: () => void;
  anchor: MenuAnchorRect | null;
  variant: "home" | "bookmarks";
  folderSort?: FolderListSort;
  bookmarkSort: BookmarkListSort;
  onFolderSort?: (sort: FolderListSort) => void;
  onBookmarkSort: (sort: BookmarkListSort) => void;
  embedded?: boolean;
  onBack?: () => void;
  onPageChange?: (page: Page) => void;
}) {
  const [page, setPageState] = useOverlaySessionMode<Page>(visible, variant === "home" ? "root" : "bookmarks");
  const setPage = (next: Page) => { setPageState(next); onPageChange?.(next); };

  const pickFolder = (sort: FolderListSort) => {
    onFolderSort?.(sort);
    onDismiss();
  };
  const pickBookmark = (sort: BookmarkListSort) => {
    onBookmarkSort(sort);
    onDismiss();
  };

  const content = (
    <>
      {page === "root" && folderSort ? (
        <>
          {onBack ? <ContextMenuItem icon="chevron-back" label="Back" onPress={onBack} /> : null}
          <ContextMenuItem
            icon="folder-outline"
            label="Folders"
            trailing={<Ionicons name="chevron-forward" />}
            onPress={() => setPage("folders")}
          />
          <ContextMenuItem
            icon="bookmark-outline"
            label="Bookmarks"
            trailing={<Ionicons name="chevron-forward" />}
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
    </>
  );
  return embedded ? content : <ContextMenu visible={visible} onDismiss={onDismiss} anchor={anchor} pageKey={page}>{content}</ContextMenu>;
}
