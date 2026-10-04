/**
 * Folder detail: cursor-paginated bookmark list with infinite scroll.
 * Handles protected folders (unlock sheet → token cached → list loads),
 * optimistic toggle/delete/move, mark-all-read, and folder actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAppRouter as useRouter } from "../../../src/hooks/use-app-router";
import { ThemedFlashList } from "../../../src/components/ui/ThemedScrollView";
import { Header, HeaderActions, HeaderIconButton } from "../../../src/components/ui/Header";
import { SelectionHeader } from "../../../src/components/bookmarks/SelectionHeader";
import { SelectionTools } from "../../../src/components/bookmarks/SelectionTools";
import { FAB, FABDock } from "../../../src/components/ui/FAB";
import { listPosition } from "../../../src/theme/list-shape";
import { Button } from "../../../src/components/ui/Button";
import { ScreenContent } from "../../../src/components/ui/ScreenContent";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { BookmarkListSkeleton } from "../../../src/components/ui/BookmarkListSkeleton";
import { BookmarkRow } from "../../../src/components/bookmarks/BookmarkRow";
import { ExtractionProgressLine } from "../../../src/components/bookmarks/ExtractionProgressLine";
import { AddBookmarkSheet } from "../../../src/components/bookmarks/AddBookmarkSheet";
import { MoveSheet } from "../../../src/components/bookmarks/MoveSheet";
import { LockPrompt } from "../../../src/components/bookmarks/LockPrompt";
import { BookmarkActionsSheet } from "../../../src/components/bookmarks/BookmarkActionsSheet";
import { FolderActionsSheet } from "../../../src/components/bookmarks/FolderActionsSheet";
import { SortMenu } from "../../../src/components/bookmarks/SortMenu";
import { EditTagsSheet } from "../../../src/components/tags/EditTagsSheet";
import { useFolders } from "../../../src/hooks/queries";
import { useListSortStore } from "../../../src/store/list-sort";
import { useFolderUnlocked } from "../../../src/hooks/use-folders";
import {
  useInfiniteBookmarks,
  useToggleRead,
  useDeleteBookmark,
  useMarkAllRead,
} from "../../../src/hooks/use-bookmarks";
import { useLegacyReaderLink } from "../../../src/hooks/use-legacy-reader-link";
import { bookmarkKey, useSelectionMode } from "../../../src/hooks/use-selection";
import { SelectionDragFrame, useSelectionDrag } from "../../../src/components/bookmarks/SelectionDrag";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { markedAsReadToast } from "../../../src/lib/copy";
import { errorMessage, isFolderProtected } from "../../../src/lib/error-message";
import { flattenPages } from "../../../src/lib/api/query-keys";
import { sortBookmarksBy } from "../../../src/lib/list-sort";
import { layout } from "../../../src/theme/tokens";
import { DEFAULT_BOOKMARK_LIST_SORT, type BookmarkDto } from "@ordo/shared";
import { openListBookmark } from "../../../src/lib/open-website";
import { useLoadMore, usePullToRefresh } from "../../../src/hooks/use-list-controls";
import { ListLoadingFooter } from "../../../src/components/ui/ListLoadingFooter";
import type { MenuAnchorRect } from "../../../src/lib/menu-anchor";
import { useBookmarkListLayout } from "../../../src/hooks/use-bookmark-list-layout";

export default function FolderDetailScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const pageMax = layout.maxContentWidth;
  const { bottom: dockInset, selectionClearance, listOverlayClearance } = useFloatingDockMetrics();
  const { id, bookmark } = useLocalSearchParams<{ id: string; bookmark?: string }>();
  const routeId = Array.isArray(id) ? id[0] : id;
  useLegacyReaderLink(bookmark);
  /** "root" (or a missing param) maps to the unfiled list; otherwise a real folder id. */
  const isRoot = routeId === "root";
  const folderId = isRoot || !routeId ? null : routeId;

  const { data: folders, isLoading: foldersLoading } = useFolders();
  const folder = useMemo(() => folders?.find((f) => f.id === folderId), [folders, folderId]);
  const unlocked = useFolderUnlocked(folderId);
  const locked = Boolean(folderId && !foldersLoading && folder?.protected && !unlocked);

  const bookmarks = useInfiniteBookmarks(
    folderId,
    !!routeId && !locked && !(Boolean(folderId) && foldersLoading),
  );
  const toggleRead = useToggleRead(folderId);
  const deleteBm = useDeleteBookmark(folderId);
  const markAll = useMarkAllRead(folderId);

  const [addOpen, setAddOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<BookmarkDto | null>(null);
  const [actionBm, setActionBm] = useState<BookmarkDto | null>(null);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<MenuAnchorRect | null>(null);
  const [editTagsBm, setEditTagsBm] = useState<BookmarkDto | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [folderActions, setFolderActions] = useState(false);
  const [folderAnchor, setFolderAnchor] = useState<MenuAnchorRect | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<MenuAnchorRect | null>(null);
  const bookmarkSort = useListSortStore((state) =>
    folderId ? (state.folderBookmarkSorts[folderId] ?? DEFAULT_BOOKMARK_LIST_SORT) : state.unfiledSort,
  );
  const setUnfiledSort = useListSortStore((state) => state.setUnfiledSort);
  const setFolderBookmarkSort = useListSortStore((state) => state.setFolderBookmarkSort);
  const selection = useSelectionMode();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const protectedError = !!bookmarks.error && isFolderProtected(bookmarks.error) && !unlocked;
  const showLocked = locked || protectedError;
  useEffect(() => {
    setUnlockOpen(showLocked);
  }, [showLocked]);
  const loadFailed = !!bookmarks.error && !showLocked && !bookmarks.data;
  const items = useMemo(
    () => sortBookmarksBy(flattenPages(bookmarks.data?.pages ?? []), bookmarkSort),
    [bookmarkSort, bookmarks.data],
  );
  const selectedBookmarks = useMemo(
    () => items.filter((bookmark) => selection.has(bookmarkKey(bookmark.id))),
    [items, selection],
  );
  const selectableKeys = useMemo(() => items.map((bookmark) => bookmarkKey(bookmark.id)), [items]);
  const getItemLayout = useBookmarkListLayout(items);
  const isEmpty = !foldersLoading && !bookmarks.isLoading && !showLocked && !loadFailed && items.length === 0;
  // Root isn't a folder row, so derive unread state from the loaded items.
  const hasUnread = folder ? folder.unreadCount > 0 : items.some((b) => !b.isRead);

  const openReader = useCallback((b: BookmarkDto) => {
    return openListBookmark(b, () => router.push(`/reader/${b.id}`));
  }, [router]);

  const onPressBookmark = useCallback((bookmark: BookmarkDto) => {
    const sel = selectionRef.current;
    if (sel.active) sel.toggle(bookmarkKey(bookmark.id));
    else return openReader(bookmark);
  }, [openReader]);

  const onMoreBookmark = useCallback((b: BookmarkDto, anchor: MenuAnchorRect) => {
    setBookmarkAnchor(anchor);
    setActionBm(b);
  }, []);

  const onEnterSelection = useCallback((bookmark: BookmarkDto) => {
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
  const openTag = useCallback((tagId: string) => router.push(`/tags/${tagId}`), [router]);
  const renderBookmark = useCallback(
    ({ item, index }: { item: BookmarkDto; index: number }) => (
      <BookmarkRow
        bookmark={item}
        position={listPosition(index, items.length)}
        selectionMode={selectionActive}
        selected={selectionActive && selectionRef.current.has(bookmarkKey(item.id))}
        onPress={onPressBookmark}
        onTagPress={openTag}
        onEnterSelection={onEnterSelection}
        onMore={onMoreBookmark}
      />
    ),
    [onEnterSelection, onMoreBookmark, onPressBookmark, selectionActive, selectionRevision, items.length, openTag],
  );

  const { onEndReached, loadingMore, resetPaging } = useLoadMore({
    hasNextPage: !!bookmarks.hasNextPage,
    isFetchingNextPage: bookmarks.isFetchingNextPage,
    fetchNextPage: bookmarks.fetchNextPage,
    data: bookmarks.data,
  });
  const refetchBookmarks = useCallback(async () => {
    resetPaging();
    await bookmarks.refetch();
  }, [bookmarks.refetch, resetPaging]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchBookmarks);

  const onToggleRead = (b: BookmarkDto) => {
    haptics.light();
    toggleRead.mutate({ id: b.id, isRead: !b.isRead });
  };

  const onDelete = (b: BookmarkDto) => {
    haptics.medium();
    deleteBm.mutate(b);
  };

  const onMarkAllRead = () => {
    haptics.medium();
    markAll.mutate(undefined, {
      onSuccess: (r) => toast.success(markedAsReadToast(r.updated)),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const listContentPadding = selection.active ? selectionClearance : listOverlayClearance;
  const listPane = (
    <SelectionDragFrame drag={drag}>
    <ThemedFlashList
      ref={drag.listRef}
      onScroll={drag.onScroll}
      onContentSizeChange={drag.onContentSizeChange}
      scrollEventThrottle={drag.scrollEventThrottle}
      data={items}
      extraData={`${selectionRevision}:${bookmarkSort}`}
      getItemLayout={getItemLayout}
      key={`folder:${folderId ?? "root"}`}
      keyExtractor={(b: BookmarkDto) => b.id}
      renderItem={renderBookmark}
      contentContainerStyle={{ paddingBottom: listContentPadding }}
      refreshing={refreshing}
      onRefresh={onRefresh}
      scrollEnabled={drag.scrollEnabled}
      onEndReached={onEndReached}
      ListFooterComponent={loadingMore ? <ListLoadingFooter /> : null}
    />
    </SelectionDragFrame>
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
          maxWidth={pageMax}
        />
      ) : (
      <Header
        title={folder?.name ?? (isRoot ? "Bookmarks" : "Folder")}
        subtitle={folder ? `${folder.bookmarkCount} ${folder.bookmarkCount === 1 ? "bookmark" : "bookmarks"}` : undefined}
        showBack
        maxWidth={pageMax}
        right={
          <HeaderActions>
            {hasUnread && !showLocked && !loadFailed ? (
              <HeaderIconButton
                name="checkmark-done"
                color={palette.accent}
                onPress={onMarkAllRead}
                accessibilityLabel="Mark all as read"
              />
            ) : null}
            {!showLocked && !loadFailed ? (
              <HeaderIconButton
                name="swap-vertical-outline"
                color={palette.text}
                onPress={(anchor) => {
                  setSortAnchor(anchor);
                  setSortOpen(true);
                }}
                accessibilityLabel="Sort"
                accessibilityHint="Change how bookmarks are ordered."
              />
            ) : null}
            {folder ? (
              <HeaderIconButton
                name="ellipsis-horizontal"
                color={palette.text}
                onPress={(anchor) => {
                  setFolderAnchor(anchor);
                  setFolderActions(true);
                }}
                accessibilityLabel="Folder actions"
              />
            ) : null}
          </HeaderActions>
        }
      />
      )}

      <ExtractionProgressLine maxWidth={pageMax} />

      {showLocked && folderId ? (
        <ScreenContent maxWidth={pageMax} style={styles.center}>
          <EmptyState
            icon="lock-closed-outline"
            title="This folder is locked"
            message="Unlock it to view its bookmarks."
            action={<Button label="Unlock" onPress={() => setUnlockOpen(true)} />}
          />
        </ScreenContent>
      ) : loadFailed ? (
        <ScreenContent maxWidth={pageMax} style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load bookmarks"
            message={errorMessage(bookmarks.error)}
            action={<Button label="Retry" onPress={() => bookmarks.refetch()} />}
          />
        </ScreenContent>
      ) : isEmpty ? (
        <ScreenContent maxWidth={pageMax} style={styles.center}>
          <EmptyState
            icon="bookmark-outline"
            title="No bookmarks here"
            message="Save a link to start reading."
            action={<Button onPress={() => setAddOpen(true)} label="Save bookmark" />}
          />
        </ScreenContent>
      ) : bookmarks.isLoading || (Boolean(folderId) && foldersLoading) ? (
        <ScreenContent
          maxWidth={pageMax}
          style={styles.content}
        >
          <BookmarkListSkeleton />
        </ScreenContent>
      ) : (
        <ScreenContent maxWidth={pageMax} style={styles.content}>
          {listPane}
        </ScreenContent>
      )}

      {!showLocked && !loadFailed && !selection.active ? (
        <FABDock maxWidth={pageMax}>
          <FAB
            onPress={() => setAddOpen(true)}
            accessibilityLabel="Save bookmark"
            accessibilityHint="Tap to save a bookmark."
            testID="add-bookmark-fab"
            maxContentWidth={pageMax}
          />
        </FABDock>
      ) : null}

      <AddBookmarkSheet
        visible={addOpen}
        onDismiss={() => setAddOpen(false)}
        folderId={folderId}
        folderName={folder?.name ?? null}
      />

      <BookmarkActionsSheet
        visible={!!actionBm}
        bookmark={actionBm}
        anchor={bookmarkAnchor}
        onDismiss={() => {
          setActionBm(null);
          setBookmarkAnchor(null);
        }}
        onToggleRead={onToggleRead}
        onMove={(b) => setMoveTarget(b)}
        onDelete={onDelete}
        onEditTags={setEditTagsBm}
      />

      <EditTagsSheet
        visible={!!editTagsBm}
        bookmark={editTagsBm}
        onDismiss={() => setEditTagsBm(null)}
      />

      <MoveSheet
        visible={!!moveTarget}
        bookmark={moveTarget}
        fromFolderId={folderId}
        onDismiss={() => setMoveTarget(null)}
      />

      <LockPrompt
        visible={showLocked && unlockOpen && Boolean(folderId)}
        folderId={folderId ?? ""}
        folderName={folder?.name}
        lockType={folder?.lockType}
        pinLength={folder?.pinLength}
        onDismiss={() => setUnlockOpen(false)}
      />

      <SortMenu
        visible={sortOpen}
        onDismiss={() => {
          setSortOpen(false);
          setSortAnchor(null);
        }}
        anchor={sortAnchor}
        variant="bookmarks"
        bookmarkSort={bookmarkSort}
        onBookmarkSort={(sort) => {
          if (folderId) setFolderBookmarkSort(folderId, sort);
          else setUnfiledSort(sort);
        }}
      />

      <FolderActionsSheet
        visible={folderActions}
        folder={folder ?? null}
        anchor={folderAnchor}
        onDismiss={() => setFolderActions(false)}
        onDeleted={() => {
          setFolderActions(false);
          router.replace("/");
        }}
      />

      <SelectionTools
        active={selection.active}
        bookmarks={selectedBookmarks}
        fromFolderId={folderId}
        onFinished={selection.exit}
        bottom={dockInset}
        maxWidth={pageMax}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, width: "100%" },
  center: { flex: 1, width: "100%", justifyContent: "center" },
});
