/** Bookmarks home: folders and unfiled bookmarks in one library list. */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { Header, HeaderActions, HeaderIconButton, HEADER_CONTROL_SIZE } from "../../src/components/ui/Header";
import { SelectionHeader } from "../../src/components/bookmarks/SelectionHeader";
import { SelectionTools } from "../../src/components/bookmarks/SelectionTools";
import { FAB, FABLayer } from "../../src/components/ui/FAB";
import { ContextMenu, ContextMenuItem } from "../../src/components/ui/ContextMenu";
import { Button } from "../../src/components/ui/Button";
import { Text } from "../../src/components/ui/Text";
import { PressableScale } from "../../src/components/ui/PressableScale";
import { ScreenContent } from "../../src/components/ui/ScreenContent";
import { BookmarkListSkeleton } from "../../src/components/ui/BookmarkListSkeleton";
import { EmptyState } from "../../src/components/ui/EmptyState";
import { AddBookmarkSheet } from "../../src/components/bookmarks/AddBookmarkSheet";
import { BookmarkActionsSheet } from "../../src/components/bookmarks/BookmarkActionsSheet";
import { FolderRow } from "../../src/components/bookmarks/FolderRow";
import { FolderActionsSheet } from "../../src/components/bookmarks/FolderActionsSheet";
import { CreateFolderPanel } from "../../src/components/bookmarks/CreateFolderPanel";
import { MoveSheet } from "../../src/components/bookmarks/MoveSheet";
import { BookmarkRow } from "../../src/components/bookmarks/BookmarkRow";
import { ExtractionProgressLine } from "../../src/components/bookmarks/ExtractionProgressLine";
import { EditTagsSheet } from "../../src/components/tags/EditTagsSheet";
import { useFolders } from "../../src/hooks/use-folders";
import { useTags } from "../../src/hooks/use-tags";
import {
  useDeleteBookmark,
  useInfiniteBookmarks,
  useMarkAllRead,
  useToggleRead,
} from "../../src/hooks/use-bookmarks";
import { useFloatingDockMetrics } from "../../src/hooks/use-floating-dock-metrics";
import { bookmarkKey, folderKey, useSelectionMode } from "../../src/hooks/use-selection";
import { useTheme } from "../../src/theme/ThemeProvider";
import { haptics } from "../../src/lib/haptics";
import { toast } from "../../src/components/ui/toast-store";
import { markedAsReadToast } from "../../src/lib/copy";
import { errorMessage } from "../../src/lib/error-message";
import { flattenPages } from "../../src/lib/api/query-keys";
import {
  useSettingsStore,
  type CreateButtonAction,
} from "../../src/store/settings";
import { layout, spacing } from "../../src/theme/tokens";
import { type BookmarkDto, type FolderDto } from "@ordo/shared";
import { openListBookmark } from "../../src/lib/open-website";
import type { MenuAnchorRect } from "../../src/lib/menu-anchor";

type LibraryItem =
  | { type: "folder"; folder: FolderDto }
  | { type: "bookmark"; bookmark: BookmarkDto };

export default function BookmarksScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { visible: floatingNavigation, clearance: bottomClearance, bottom: dockInset, selectionClearance } = useFloatingDockMetrics();
  const folders = useFolders();
  const tags = useTags();
  const bookmarks = useInfiniteBookmarks(null);
  const toggleRead = useToggleRead(null);
  const deleteBookmark = useDeleteBookmark(null);
  const markAllRead = useMarkAllRead(null);
  const createButtonTapAction = useSettingsStore((s) => s.createButtonTapAction);

  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createAnchor, setCreateAnchor] = useState<MenuAnchorRect | null>(null);
  const [actionsFolder, setActionsFolder] = useState<FolderDto | null>(null);
  const [folderAnchor, setFolderAnchor] = useState<MenuAnchorRect | null>(null);
  const [actionBookmark, setActionBookmark] = useState<BookmarkDto | null>(null);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<MenuAnchorRect | null>(null);
  const [moveTarget, setMoveTarget] = useState<BookmarkDto | null>(null);
  const [editTagsTarget, setEditTagsTarget] = useState<BookmarkDto | null>(null);
  const selection = useSelectionMode();

  const items = useMemo(() => flattenPages(bookmarks.data?.pages ?? []), [bookmarks.data]);
  const hasUnread = items.some((bookmark) => !bookmark.isRead);
  const folderItems = folders.data ?? [];
  const tagCount = tags.data?.length ?? 0;
  const libraryItems = useMemo<LibraryItem[]>(
    () => [
      ...folderItems.map((folder) => ({ type: "folder" as const, folder })),
      ...items.map((bookmark) => ({ type: "bookmark" as const, bookmark })),
    ],
    [folderItems, items],
  );
  const libraryLoading = (folders.isLoading || bookmarks.isLoading) && libraryItems.length === 0;
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

  const refresh = async () => {
    await Promise.all([bookmarks.refetch(), folders.refetch(), tags.refetch()]);
  };

  const loadMore = () => {
    if (bookmarks.hasNextPage && !bookmarks.isFetchingNextPage) {
      void bookmarks.fetchNextPage();
    }
  };

  const openBookmark = (bookmark: BookmarkDto) => {
    openListBookmark(bookmark, () => {
      router.push(`/reader/${bookmark.id}`);
    });
  };

  const runCreateAction = (action: CreateButtonAction, anchor?: MenuAnchorRect) => {
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

  const openFolder = (folder: FolderDto) => {
    router.push(`/folder/${folder.id}`);
  };

  const headerRight = (
    <HeaderActions style={styles.headerActions}>
      <PressableScale
        style={styles.tagsLink}
        onPress={() => {
          haptics.light();
          router.push("/tags");
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Tags, ${tagCount} ${tagCount === 1 ? "tag" : "tags"}`}
        accessibilityHint="Browse and manage tags."
      >
        <Ionicons name="pricetags-outline" size={11} color={palette.textTertiary} />
        <Text variant="label" color="secondary">
          Tags
        </Text>
      </PressableScale>
      {hasUnread ? (
        <HeaderIconButton
          name="checkmark-done"
          color={palette.accent}
          onPress={onMarkAllRead}
          accessibilityLabel="Mark all as read"
        />
      ) : null}
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
            action={<Button label="Retry" onPress={refresh} />}
          />
        </ScreenContent>
      ) : (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.content}>
          <FlashList
            data={libraryItems}
            keyExtractor={(item: LibraryItem) =>
              item.type === "folder" ? folderKey(item.folder.id) : bookmarkKey(item.bookmark.id)
            }
            getItemType={(item: LibraryItem) => item.type}
            overrideItemLayout={(layout, item: LibraryItem) => {
              layout.size = item.type === "folder" ? 76 : 108;
            }}
            renderItem={({ item }: { item: LibraryItem }) => {
              if (item.type === "folder") {
                return (
                  <FolderRow
                    folder={item.folder}
                    selectionMode={selection.active}
                    selected={selection.has(folderKey(item.folder.id))}
                    onPress={(selectedFolder) => {
                      if (selection.active) {
                        selection.toggle(folderKey(selectedFolder.id));
                        return;
                      }
                      openFolder(selectedFolder);
                    }}
                    onMore={(selectedFolder, anchor) => {
                      setFolderAnchor(anchor);
                      setActionsFolder(selectedFolder);
                    }}
                    highlighted={actionsFolder?.id === item.folder.id}
                  />
                );
              }
              return (
                <BookmarkRow
                  bookmark={item.bookmark}
                  selectionMode={selection.active}
                  selected={selection.has(bookmarkKey(item.bookmark.id))}
                  onPress={(bookmark) => {
                    if (selection.active) selection.toggle(bookmarkKey(bookmark.id));
                    else openBookmark(bookmark);
                  }}
                  onMore={(bookmark, anchor) => {
                    setBookmarkAnchor(anchor);
                    setActionBookmark(bookmark);
                  }}
                  highlighted={actionBookmark?.id === item.bookmark.id}
                />
              );
            }}
            extraData={`${selection.revision}:${actionBookmark?.id ?? ""}:${actionsFolder?.id ?? ""}`}
            estimatedItemSize={108}
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
            ListFooterComponent={
              bookmarks.isFetchingNextPage ? (
                <View style={styles.footer}><ActivityIndicator color={palette.accent} /></View>
              ) : null
            }
            contentContainerStyle={{
              paddingTop: spacing[8],
              paddingBottom: selection.active
                ? selectionClearance
                : floatingNavigation
                  ? bottomClearance
                  : spacing[96],
            }}
            refreshing={(bookmarks.isFetching || folders.isFetching || tags.isFetching) && !bookmarks.isLoading}
            onRefresh={refresh}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
          />
        </ScreenContent>
      )}

      {!selection.active ? (
      <FABLayer maxWidth={layout.maxContentWidth}>
        <FAB
          onPress={(anchor) => runCreateAction(createButtonTapAction, anchor)}
          onLongPress={() => selection.enter()}
          accessibilityLabel={createActionLabel(createButtonTapAction)}
          accessibilityHint={`Tap to ${createActionDescription(createButtonTapAction)}. Press and hold to select items.`}
          testID="add-bookmark-fab"
          bottom={floatingNavigation ? bottomClearance : spacing[20]}
          right={spacing[20]}
        />
      </FABLayer>
      ) : null}

      <ContextMenu visible={createMenuOpen} onDismiss={() => setCreateMenuOpen(false)} anchor={createAnchor}>
        <ContextMenuItem
          icon="bookmark-outline"
          label="Save bookmark"
          onPress={() => {
            setCreateMenuOpen(false);
            setTimeout(() => setAddOpen(true), 100);
          }}
        />
        <ContextMenuItem
          icon="folder-outline"
          label="New folder"
          onPress={() => {
            setCreateMenuOpen(false);
            setTimeout(() => setCreateOpen(true), 100);
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
  headerActions: { gap: spacing[4] },
  tagsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[6],
    height: HEADER_CONTROL_SIZE,
    paddingHorizontal: spacing[4],
  },
  emptyBookmarks: { minHeight: 300, justifyContent: "center" },
  footer: { paddingVertical: spacing[20], alignItems: "center" },
});
