/**
 * Folder detail: cursor-paginated bookmark list with infinite scroll.
 * Handles protected folders (unlock sheet → token cached → list loads),
 * optimistic toggle/delete/move, mark-all-read, and folder actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedFlashList } from "../../../src/components/ui/ThemedScrollView";
import { Header, HeaderActions, HeaderIconButton } from "../../../src/components/ui/Header";
import { SelectionHeader } from "../../../src/components/bookmarks/SelectionHeader";
import { SelectionTools } from "../../../src/components/bookmarks/SelectionTools";
import { FAB, FABLayer } from "../../../src/components/ui/FAB";
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
import { EditTagsSheet } from "../../../src/components/tags/EditTagsSheet";
import { ReaderPane, ReaderPanePlaceholder } from "../../../src/components/reader/ReaderPane";
import { useFolders } from "../../../src/hooks/queries";
import { useFolderUnlocked } from "../../../src/hooks/use-folders";
import {
  useInfiniteBookmarks,
  useToggleRead,
  useDeleteBookmark,
  useMarkAllRead,
} from "../../../src/hooks/use-bookmarks";
import { useResponsiveLayout } from "../../../src/hooks/use-responsive-layout";
import { bookmarkKey, useSelectionMode } from "../../../src/hooks/use-selection";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { markedAsReadToast } from "../../../src/lib/copy";
import { errorMessage, isFolderProtected } from "../../../src/lib/error-message";
import { flattenPages } from "../../../src/lib/api/query-keys";
import { layout, radius, spacing } from "../../../src/theme/tokens";
import { type BookmarkDto } from "@ordo/shared";
import { openListBookmark } from "../../../src/lib/open-website";
import { estimateBookmarkRowSize } from "../../../src/lib/bookmark-row-layout";
import type { MenuAnchorRect } from "../../../src/lib/menu-anchor";

export default function FolderDetailScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { hasDetailPane } = useResponsiveLayout();
  const { bottom: dockInset, selectionClearance } = useFloatingDockMetrics();
  const { id, bookmark } = useLocalSearchParams<{ id: string; bookmark?: string }>();
  const routeId = Array.isArray(id) ? id[0] : id;
  const selectedBookmarkId = Array.isArray(bookmark) ? bookmark[0] : bookmark;
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
  const selection = useSelectionMode();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const protectedError = !!bookmarks.error && isFolderProtected(bookmarks.error) && !unlocked;
  const showLocked = locked || protectedError;
  useEffect(() => {
    setUnlockOpen(showLocked);
  }, [showLocked]);
  const loadFailed = !!bookmarks.error && !showLocked && !bookmarks.data;
  const items = useMemo(() => flattenPages(bookmarks.data?.pages ?? []), [bookmarks.data]);
  const selectedBookmarks = useMemo(
    () => items.filter((bookmark) => selection.has(bookmarkKey(bookmark.id))),
    [items, selection],
  );
  const selectableKeys = useMemo(() => items.map((bookmark) => bookmarkKey(bookmark.id)), [items]);
  const isEmpty = !foldersLoading && !bookmarks.isLoading && !showLocked && !loadFailed && items.length === 0;
  // Root isn't a folder row, so derive unread state from the loaded items.
  const hasUnread = folder ? folder.unreadCount > 0 : items.some((b) => !b.isRead);

  const openReader = useCallback((b: BookmarkDto) => {
    openListBookmark(b, () => {
      if (hasDetailPane) {
        router.push({
          pathname: "/folder/[id]",
          params: { id: folderId ?? "root", bookmark: b.id },
        });
        return;
      }
      router.push(`/reader/${b.id}`);
    });
  }, [hasDetailPane, folderId, router]);

  const onPressBookmark = useCallback((bookmark: BookmarkDto) => {
    const sel = selectionRef.current;
    if (sel.active) sel.toggle(bookmarkKey(bookmark.id));
    else openReader(bookmark);
  }, [openReader]);

  const onMoreBookmark = useCallback((b: BookmarkDto, anchor: MenuAnchorRect) => {
    setBookmarkAnchor(anchor);
    setActionBm(b);
  }, []);

  const onEnterSelection = useCallback((bookmark: BookmarkDto) => {
    selectionRef.current.enter(bookmarkKey(bookmark.id));
  }, []);

  const selectionActive = selection.active;
  const selectionRevision = selection.revision;
  const renderBookmark = useCallback(
    ({ item }: { item: BookmarkDto }) => (
      <BookmarkRow
        bookmark={item}
        selectionMode={selectionActive}
        selected={
          selectionActive
            ? selectionRef.current.has(bookmarkKey(item.id))
            : hasDetailPane && item.id === selectedBookmarkId
        }
        onPress={onPressBookmark}
        onEnterSelection={onEnterSelection}
        onMore={onMoreBookmark}
      />
    ),
    [hasDetailPane, onEnterSelection, onMoreBookmark, onPressBookmark, selectedBookmarkId, selectionActive, selectionRevision],
  );
  const overrideItemLayout = useCallback((layout: { size?: number }, item: BookmarkDto) => {
    layout.size = estimateBookmarkRowSize(item);
  }, []);

  const loadMore = () => {
    if (bookmarks.hasNextPage && !bookmarks.isFetchingNextPage) {
      bookmarks.fetchNextPage();
    }
  };

  const onToggleRead = (b: BookmarkDto) => {
    haptics.light();
    toggleRead.mutate({ id: b.id, isRead: !b.isRead });
  };

  const onDelete = (b: BookmarkDto) => {
    haptics.medium();
    deleteBm.mutate(b, {
      onDeleted: () => {
        if (selectedBookmarkId === b.id) {
          router.replace({ pathname: "/folder/[id]", params: { id: folderId ?? "root" } });
        }
      },
    });
  };

  const onMarkAllRead = () => {
    haptics.medium();
    markAll.mutate(undefined, {
      onSuccess: (r) => toast.success(markedAsReadToast(r.updated)),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const listContentPadding = selection.active ? selectionClearance : spacing[96];
  const listPane = (
    <ThemedFlashList
      data={items}
      extraData={`${selectionRevision}:${selectedBookmarkId ?? ""}`}
      keyExtractor={(b: BookmarkDto) => b.id}
      renderItem={renderBookmark}
      estimatedItemSize={72}
      overrideItemLayout={overrideItemLayout}
      contentContainerStyle={{ paddingBottom: listContentPadding }}
      refreshing={bookmarks.isFetching && !bookmarks.isFetchingNextPage}
      onRefresh={() => bookmarks.refetch()}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        bookmarks.isFetchingNextPage ? (
          <View style={styles.footer}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : null
      }
    />
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
          maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
        />
      ) : (
      <Header
        title={folder?.name ?? (isRoot ? "Bookmarks" : "Folder")}
        subtitle={folder ? `${folder.bookmarkCount} ${folder.bookmarkCount === 1 ? "bookmark" : "bookmarks"}` : undefined}
        showBack
        maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
        right={
          folder ? (
            <HeaderActions>
              {hasUnread && !showLocked && !loadFailed ? (
                <HeaderIconButton
                  name="checkmark-done"
                  color={palette.accent}
                  onPress={onMarkAllRead}
                  accessibilityLabel="Mark all as read"
                />
              ) : null}
              <HeaderIconButton
                name="ellipsis-horizontal"
                color={palette.text}
                onPress={(anchor) => {
                  setFolderAnchor(anchor);
                  setFolderActions(true);
                }}
                accessibilityLabel="Folder actions"
              />
            </HeaderActions>
          ) : undefined
        }
      />
      )}

      <ExtractionProgressLine maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth} />

      {showLocked && folderId ? (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.center}>
          <EmptyState
            icon="lock-closed-outline"
            title="This folder is locked"
            message="Unlock it to view its bookmarks."
            action={<Button label="Unlock" onPress={() => setUnlockOpen(true)} />}
          />
        </ScreenContent>
      ) : loadFailed ? (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load bookmarks"
            message={errorMessage(bookmarks.error)}
            action={<Button label="Retry" onPress={() => bookmarks.refetch()} />}
          />
        </ScreenContent>
      ) : isEmpty ? (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.center}>
          <EmptyState
            icon="bookmark-outline"
            title="No bookmarks here"
            message="Save a link to start reading."
            action={<Button onPress={() => setAddOpen(true)} label="Save bookmark" />}
          />
        </ScreenContent>
      ) : bookmarks.isLoading || (Boolean(folderId) && foldersLoading) ? (
        <ScreenContent
          maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
          style={styles.content}
        >
          {hasDetailPane ? (
            <View style={styles.splitPane}>
              <View style={styles.listPane}>
                <BookmarkListSkeleton />
              </View>
              <View style={[styles.readerPane, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <ReaderPanePlaceholder />
              </View>
            </View>
          ) : (
            <View style={styles.singlePane}>
              <BookmarkListSkeleton />
            </View>
          )}
        </ScreenContent>
      ) : hasDetailPane ? (
        <ScreenContent maxWidth={layout.maxLibraryWidth} style={styles.content}>
          <View style={styles.splitPane}>
            <View style={styles.listPane}>
              {listPane}
              {selection.active ? null : (
              <FAB
                onPress={() => setAddOpen(true)}
                accessibilityLabel="Save bookmark"
                testID="add-bookmark-fab"
                right={spacing[20]}
              />
              )}
            </View>
            <View style={[styles.readerPane, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              {selectedBookmarkId ? (
                <ReaderPane
                  bookmarkId={selectedBookmarkId}
                  embedded
                  safeBottom={false}
                  onBack={() => router.setParams({ bookmark: undefined })}
                />
              ) : (
                <ReaderPanePlaceholder />
              )}
            </View>
          </View>
        </ScreenContent>
      ) : (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.content}>
          <View style={styles.singlePane}>{listPane}</View>
        </ScreenContent>
      )}

      {!showLocked && !loadFailed && !hasDetailPane && !selection.active ? (
        <FABLayer maxWidth={layout.maxContentWidth}>
          <FAB
            onPress={() => setAddOpen(true)}
            accessibilityLabel="Save bookmark"
            accessibilityHint="Tap to save a bookmark."
            testID="add-bookmark-fab"
            right={spacing[20]}
          />
        </FABLayer>
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
        onFinished={() => {
          if (hasDetailPane && selectedBookmarkId && selection.has(bookmarkKey(selectedBookmarkId))) {
            router.replace({ pathname: "/folder/[id]", params: { id: folderId ?? "root" } });
          }
          selection.exit();
        }}
        bottom={dockInset}
        maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, width: "100%" },
  center: { flex: 1, width: "100%", justifyContent: "center" },
  singlePane: { flex: 1, width: "100%" },
  splitPane: { flex: 1, width: "100%", flexDirection: "row", gap: spacing[16], paddingBottom: spacing[8] },
  listPane: { width: 380, flexShrink: 0 },
  readerPane: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  footer: { paddingVertical: spacing[20], alignItems: "center" },
});
