/** Bookmarks home: folders and unfiled bookmarks in one library list. */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ThemedFlashList } from "../../../src/components/ui/ThemedScrollView";
import { Header, HeaderActions, HeaderIconButton } from "../../../src/components/ui/Header";
import { ListLoadingFooter } from "../../../src/components/ui/ListLoadingFooter";
import { SelectionHeader } from "../../../src/components/bookmarks/SelectionHeader";
import { SelectionTools } from "../../../src/components/bookmarks/SelectionTools";
import { FAB, FABLayer } from "../../../src/components/ui/FAB";
import { ContextMenu, ContextMenuItem } from "../../../src/components/ui/ContextMenu";
import { Button } from "../../../src/components/ui/Button";
import { ScreenContent } from "../../../src/components/ui/ScreenContent";
import { BookmarkListSkeleton } from "../../../src/components/ui/BookmarkListSkeleton";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { AddBookmarkSheet } from "../../../src/components/bookmarks/AddBookmarkSheet";
import { BookmarkActionsSheet } from "../../../src/components/bookmarks/BookmarkActionsSheet";
import { SortMenu } from "../../../src/components/bookmarks/SortMenu";
import { FolderRow } from "../../../src/components/bookmarks/FolderRow";
import { FolderActionsSheet } from "../../../src/components/bookmarks/FolderActionsSheet";
import { CreateFolderPanel } from "../../../src/components/bookmarks/CreateFolderPanel";
import { LockPrompt } from "../../../src/components/bookmarks/LockPrompt";
import { MoveSheet } from "../../../src/components/bookmarks/MoveSheet";
import { BookmarkRow } from "../../../src/components/bookmarks/BookmarkRow";
import { ExtractionProgressLine } from "../../../src/components/bookmarks/ExtractionProgressLine";
import { EditTagsSheet } from "../../../src/components/tags/EditTagsSheet";
import { useFolders } from "../../../src/hooks/use-folders";
import { useFolderTokenStore } from "../../../src/store/folder-tokens";
import { useListSortStore } from "../../../src/store/list-sort";
import { sortBookmarksBy, sortFoldersBy } from "../../../src/lib/list-sort";
import { useTags } from "../../../src/hooks/use-tags";
import { useLoadMore, usePullToRefresh } from "../../../src/hooks/use-list-controls";
import {
  prefetchFolderBookmarks,
  useDeleteBookmark,
  useInfiniteBookmarks,
  useMarkAllRead,
  useToggleRead,
} from "../../../src/hooks/use-bookmarks";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import { bookmarkKey, folderKey, useSelectionMode } from "../../../src/hooks/use-selection";
import { SelectionDragFrame, useSelectionDrag } from "../../../src/components/bookmarks/SelectionDrag";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { markedAsReadToast } from "../../../src/lib/copy";
import { errorMessage } from "../../../src/lib/error-message";
import { flattenPages } from "../../../src/lib/api/query-keys";
import {
  useSettingsStore,
  type CreateButtonAction,
  type CreateButtonHoldAction,
} from "../../../src/store/settings";
import { layout, spacing } from "../../../src/theme/tokens";
import { FAB_LIST_CLEARANCE } from "../../../src/lib/list-pagination";
import { type BookmarkDto, type FolderDto } from "@ordo/shared";
import { openListBookmark } from "../../../src/lib/open-website";
import type { MenuAnchorRect } from "../../../src/lib/menu-anchor";

type LibraryItem =
  | { type: "folder"; folder: FolderDto }
  | { type: "bookmark"; bookmark: BookmarkDto };

export default function BookmarksScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { visible: floatingNavigation, clearance: bottomClearance, bottom: dockInset, selectionClearance } = useFloatingDockMetrics();
  const folders = useFolders();
  const tags = useTags();
  const folderSort = useListSortStore((state) => state.folderSort);
  const unfiledSort = useListSortStore((state) => state.unfiledSort);
  const setFolderSort = useListSortStore((state) => state.setFolderSort);
  const setUnfiledSort = useListSortStore((state) => state.setUnfiledSort);
  const bookmarks = useInfiniteBookmarks(null);
  const toggleRead = useToggleRead(null);
  const deleteBookmark = useDeleteBookmark(null);
  const markAllRead = useMarkAllRead(null);
  const createButtonTapAction = useSettingsStore((s) => s.createButtonTapAction);
  const createButtonHoldAction = useSettingsStore((s) => s.createButtonHoldAction);

  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createAnchor, setCreateAnchor] = useState<MenuAnchorRect | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<MenuAnchorRect | null>(null);
  const [unlockFolder, setUnlockFolder] = useState<FolderDto | null>(null);
  const [actionsFolder, setActionsFolder] = useState<FolderDto | null>(null);
  const [folderAnchor, setFolderAnchor] = useState<MenuAnchorRect | null>(null);
  const [actionBookmark, setActionBookmark] = useState<BookmarkDto | null>(null);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<MenuAnchorRect | null>(null);
  const [moveTarget, setMoveTarget] = useState<BookmarkDto | null>(null);
  const [editTagsTarget, setEditTagsTarget] = useState<BookmarkDto | null>(null);
  const selection = useSelectionMode();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const items = useMemo(
    () => sortBookmarksBy(flattenPages(bookmarks.data?.pages ?? []), unfiledSort),
    [bookmarks.data, unfiledSort],
  );
  const hasUnread = items.some((bookmark) => !bookmark.isRead);
  const folderItems = useMemo(
    () => sortFoldersBy(folders.data ?? [], folderSort),
    [folders.data, folderSort],
  );
  const tagCount = tags.data?.length ?? 0;
  const libraryItems = useMemo<LibraryItem[]>(
    () => [
      ...folderItems.map((folder) => ({ type: "folder" as const, folder })),
      ...items.map((bookmark) => ({ type: "bookmark" as const, bookmark })),
    ],
    [folderItems, items],
  );
  // Folders return first. Keep the skeleton until the unfiled page is in
  // too, so a cold start never paints folders and then pops bookmarks in.
  const libraryLoading =
    (folders.isPending && !folders.isError) || (bookmarks.isPending && !bookmarks.isError);
  const selectedBookmarks = useMemo(
    () => items.filter((bookmark) => selection.has(bookmarkKey(bookmark.id))),
    [items, selection],
  );
  const selectedFolders = useMemo(
    () => folderItems.filter((folder) => selection.has(folderKey(folder.id))),
    [folderItems, selection],
  );
  const selectableKeys = useMemo(
    () => [...folderItems.map((folder) => folderKey(folder.id)), ...items.map((bookmark) => bookmarkKey(bookmark.id))],
    [folderItems, items],
  );

  const onToggleRead = (bookmark: BookmarkDto) => {
    haptics.light();
    toggleRead.mutate({ id: bookmark.id, isRead: !bookmark.isRead });
  };

  const onDelete = (bookmark: BookmarkDto) => {
    haptics.medium();
    deleteBookmark.mutate(bookmark);
  };

  const onMarkAllRead = () => {
    haptics.medium();
    markAllRead.mutate(undefined, {
      onSuccess: ({ updated }) => toast.success(markedAsReadToast(updated)),
      onError: (cause) => toast.error(errorMessage(cause)),
    });
  };

  const { onEndReached, loadingMore, resetPaging } = useLoadMore({
    hasNextPage: !!bookmarks.hasNextPage,
    isFetchingNextPage: bookmarks.isFetchingNextPage,
    fetchNextPage: bookmarks.fetchNextPage,
    data: bookmarks.data,
  });
  const refreshAll = useCallback(async () => {
    resetPaging();
    await Promise.all([bookmarks.refetch(), folders.refetch(), tags.refetch()]);
  }, [bookmarks.refetch, folders.refetch, tags.refetch, resetPaging]);
  const { refreshing, onRefresh } = usePullToRefresh(refreshAll);

  const openBookmark = useCallback((bookmark: BookmarkDto) => {
    openListBookmark(bookmark, () => {
      router.push(`/reader/${bookmark.id}`);
    });
  }, [router]);

  const enterFolder = useCallback((folder: FolderDto) => {
    void prefetchFolderBookmarks(folder.id);
    router.push(`/folder/${folder.id}`);
  }, [router]);

  const openFolder = useCallback((folder: FolderDto) => {
    if (folder.protected && !useFolderTokenStore.getState().get(folder.id)) {
      setUnlockFolder(folder);
      return;
    }
    enterFolder(folder);
  }, [enterFolder]);

  const onPressFolder = useCallback((selectedFolder: FolderDto) => {
    const sel = selectionRef.current;
    if (sel.active) {
      sel.toggle(folderKey(selectedFolder.id));
      return;
    }
    openFolder(selectedFolder);
  }, [openFolder]);

  const onMoreFolder = useCallback((selectedFolder: FolderDto, anchor: MenuAnchorRect) => {
    setFolderAnchor(anchor);
    setActionsFolder(selectedFolder);
  }, []);

  const onPressLibraryBookmark = useCallback((bookmark: BookmarkDto) => {
    const sel = selectionRef.current;
    if (sel.active) sel.toggle(bookmarkKey(bookmark.id));
    else openBookmark(bookmark);
  }, [openBookmark]);

  const onMoreBookmark = useCallback((bookmark: BookmarkDto, anchor: MenuAnchorRect) => {
    setBookmarkAnchor(anchor);
    setActionBookmark(bookmark);
  }, []);

  const onEnterFolder = useCallback((selectedFolder: FolderDto) => {
    selectionRef.current.enter(folderKey(selectedFolder.id));
  }, []);

  const onEnterBookmark = useCallback((bookmark: BookmarkDto) => {
    selectionRef.current.enter(bookmarkKey(bookmark.id));
  }, []);

  const drag = useSelectionDrag({
    enabled: selection.active,
    keys: selectableKeys,
    selected: selection.ids,
    onSelectedChange: selection.assign,
  });

  const selectionActive = selection.active;
  const selectionRevision = selection.revision;
  const renderLibraryItem = useCallback(
    ({ item }: { item: LibraryItem }) => {
      if (item.type === "folder") {
        return (
          <FolderRow
            folder={item.folder}
            selectionMode={selectionActive}
            selected={selectionRef.current.has(folderKey(item.folder.id))}
            onPress={onPressFolder}
            onEnterSelection={onEnterFolder}
            onMore={onMoreFolder}
          />
        );
      }
      return (
        <BookmarkRow
          bookmark={item.bookmark}
          selectionMode={selectionActive}
          selected={selectionRef.current.has(bookmarkKey(item.bookmark.id))}
          onPress={onPressLibraryBookmark}
          onEnterSelection={onEnterBookmark}
          onMore={onMoreBookmark}
        />
      );
    },
    [
      onEnterBookmark,
      onEnterFolder,
      onMoreBookmark,
      onMoreFolder,
      onPressFolder,
      onPressLibraryBookmark,
      selectionActive,
      selectionRevision,
    ],
  );
  const libraryKeyExtractor = useCallback(
    (item: LibraryItem) => (item.type === "folder" ? folderKey(item.folder.id) : bookmarkKey(item.bookmark.id)),
    [],
  );
  // No paddingTop — the header gap is `layout.headerContentGap`, and the
  // first row's own padding sits inside that.
  const listContentStyle = useMemo(
    () => ({
      paddingBottom: selection.active
        ? selectionClearance
        : floatingNavigation
          ? bottomClearance
          : FAB_LIST_CLEARANCE,
    }),
    [bottomClearance, floatingNavigation, selection.active, selectionClearance],
  );

  const runCreateAction = (action: CreateButtonHoldAction, anchor?: MenuAnchorRect) => {
    if (action === "menu") {
      setCreateAnchor(anchor ?? null);
      setCreateMenuOpen(true);
    }
    if (action === "bookmark") setAddOpen(true);
    if (action === "folder") setCreateOpen(true);
  };

  const createActionLabel = (action: CreateButtonAction) => {
    if (action === "menu") return "Create";
    if (action === "bookmark") return "Save bookmark";
    return "New folder";
  };

  const createActionDescription = (action: CreateButtonAction) => {
    if (action === "menu") return "show create choices";
    if (action === "bookmark") return "save a bookmark";
    return "create a folder";
  };

  const headerRight = (
    <HeaderActions>
      {hasUnread ? (
        <HeaderIconButton
          name="checkmark-done"
          color={palette.accent}
          onPress={onMarkAllRead}
          accessibilityLabel="Mark all as read"
        />
      ) : null}
      <HeaderIconButton
        name="swap-vertical-outline"
        color={palette.text}
        onPress={(anchor) => {
          setSortAnchor(anchor);
          setSortOpen(true);
        }}
        accessibilityLabel="Sort"
        accessibilityHint="Change how folders and bookmarks are ordered."
      />
      <HeaderIconButton
        name="pricetags-outline"
        color={palette.text}
        onPress={() => router.push("/tags")}
        accessibilityLabel={`Tags, ${tagCount} ${tagCount === 1 ? "tag" : "tags"}`}
        accessibilityHint="Browse and manage tags."
      />
    </HeaderActions>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {selection.active ? (
        <SelectionHeader
          count={selection.count}
          selectableCount={selectableKeys.length}
          onCancel={selection.exit}
          onToggleSelectAll={() => {
            if (selection.count === selectableKeys.length) selection.replace([]);
            else selection.replace(selectableKeys);
          }}
          maxWidth={layout.maxContentWidth}
        />
      ) : (
      <Header
        title="Bookmarks"
        large
        maxWidth={layout.maxContentWidth}
        right={headerRight}
      />
      )}

      <ExtractionProgressLine />

      {bookmarks.error && !bookmarks.data && folderItems.length === 0 && !folders.isLoading ? (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load bookmarks"
            message={errorMessage(bookmarks.error)}
            action={<Button label="Retry" onPress={onRefresh} />}
          />
        </ScreenContent>
      ) : (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.content}>
          <SelectionDragFrame drag={drag}>
          <ThemedFlashList
            ref={drag.listRef}
            onScroll={drag.onScroll}
            onContentSizeChange={drag.onContentSizeChange}
            scrollEventThrottle={drag.scrollEventThrottle}
            data={libraryLoading ? [] : libraryItems}
            extraData={`${selectionRevision}:${folderSort}:${unfiledSort}`}
            key={`home:${folderSort}:${unfiledSort}`}
            keyExtractor={libraryKeyExtractor}
            renderItem={renderLibraryItem}
            ListEmptyComponent={
              libraryLoading ? (
                <BookmarkListSkeleton />
              ) : (
                <View style={styles.emptyBookmarks}>
                  <EmptyState
                    icon="bookmark-outline"
                    title="No bookmarks yet"
                    message="Save a link to start reading."
                    action={<Button label="Save bookmark" onPress={() => setAddOpen(true)} />}
                  />
                </View>
              )
            }
            ListFooterComponent={loadingMore ? <ListLoadingFooter /> : null}
            contentContainerStyle={listContentStyle}
            refreshing={refreshing}
            onRefresh={onRefresh}
            waitFor={drag.scrollWaitFor}
            onEndReached={onEndReached}
          />
          </SelectionDragFrame>
        </ScreenContent>
      )}

      {!selection.active ? (
      <FABLayer maxWidth={layout.maxContentWidth}>
        <FAB
          onPress={(anchor) => runCreateAction(createButtonTapAction, anchor)}
          onLongPress={(anchor) => {
            if (createButtonHoldAction !== "none") haptics.medium();
            runCreateAction(createButtonHoldAction, anchor);
          }}
          accessibilityLabel={createActionLabel(createButtonTapAction)}
          accessibilityHint={
            createButtonHoldAction === "none"
              ? `Tap to ${createActionDescription(createButtonTapAction)}. Press and hold is disabled.`
              : `Tap to ${createActionDescription(createButtonTapAction)}. Press and hold to ${createActionDescription(createButtonHoldAction)}.`
          }
          testID="add-bookmark-fab"
          bottom={floatingNavigation ? bottomClearance : spacing[20]}
          right={spacing[20]}
        />
      </FABLayer>
      ) : null}

      <SortMenu
        visible={sortOpen}
        onDismiss={() => {
          setSortOpen(false);
          setSortAnchor(null);
        }}
        anchor={sortAnchor}
        variant="home"
        folderSort={folderSort}
        bookmarkSort={unfiledSort}
        onFolderSort={setFolderSort}
        onBookmarkSort={setUnfiledSort}
      />

      <ContextMenu visible={createMenuOpen} onDismiss={() => setCreateMenuOpen(false)} anchor={createAnchor}>
        <ContextMenuItem
          icon="bookmark-outline"
          label="Save bookmark"
          onPress={() => {
            setCreateMenuOpen(false);
            setAddOpen(true);
          }}
        />
        <ContextMenuItem
          icon="folder-outline"
          label="New folder"
          onPress={() => {
            setCreateMenuOpen(false);
            setCreateOpen(true);
          }}
        />
      </ContextMenu>

      <AddBookmarkSheet
        visible={addOpen}
        onDismiss={() => setAddOpen(false)}
        folderId={null}
        allowFolderSelection
      />

      <BookmarkActionsSheet
        visible={!!actionBookmark}
        bookmark={actionBookmark}
        anchor={bookmarkAnchor}
        onDismiss={() => {
          setActionBookmark(null);
          setBookmarkAnchor(null);
        }}
        onToggleRead={onToggleRead}
        onMove={setMoveTarget}
        onDelete={onDelete}
        onEditTags={setEditTagsTarget}
      />

      <EditTagsSheet
        visible={!!editTagsTarget}
        bookmark={editTagsTarget}
        onDismiss={() => setEditTagsTarget(null)}
      />

      <MoveSheet
        visible={!!moveTarget}
        bookmark={moveTarget}
        fromFolderId={null}
        onDismiss={() => setMoveTarget(null)}
      />

      <CreateFolderPanel visible={createOpen} onDismiss={() => setCreateOpen(false)} />

      <LockPrompt
        visible={!!unlockFolder}
        folderId={unlockFolder?.id ?? ""}
        folderName={unlockFolder?.name}
        lockType={unlockFolder?.lockType}
        pinLength={unlockFolder?.pinLength}
        onDismiss={() => setUnlockFolder(null)}
        onUnlocked={() => {
          const folder = unlockFolder;
          setUnlockFolder(null);
          if (folder) enterFolder(folder);
        }}
      />

      <FolderActionsSheet
        visible={!!actionsFolder}
        folder={actionsFolder}
        anchor={folderAnchor}
        onDismiss={() => {
          setActionsFolder(null);
          setFolderAnchor(null);
        }}
        onDeleted={() => {
          setActionsFolder(null);
          setFolderAnchor(null);
        }}
      />

      <SelectionTools
        active={selection.active}
        bookmarks={selectedBookmarks}
        folders={selectedFolders}
        fromFolderId={null}
        onFinished={selection.exit}
        bottom={dockInset}
        maxWidth={layout.maxContentWidth}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, width: "100%" },
  center: { flex: 1, width: "100%", justifyContent: "center" },
  emptyBookmarks: { minHeight: 300, justifyContent: "center" },
});
