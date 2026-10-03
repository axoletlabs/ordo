/** Bookmarks home: folders and unfiled bookmarks in one library list. */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedFlashList } from "../../../src/components/ui/ThemedScrollView";
import { HeaderActions, HeaderIconButton } from "../../../src/components/ui/Header";
import { LibraryHeader } from "../../../src/components/bookmarks/LibraryHeader";
import { LibraryFilters } from "../../../src/components/bookmarks/LibraryFilters";
import { SearchFilterMenu } from "../../../src/components/bookmarks/SearchFilterMenu";
import { ReaderPane, ReaderPanePlaceholder } from "../../../src/components/reader/ReaderPane";
import { useLibrarySearch } from "../../../src/hooks/use-library-search";
import { useResponsiveLayout } from "../../../src/hooks/use-responsive-layout";
import { sanitizeRouteParam, searchScopeActive } from "../../../src/lib/search-bookmarks";
import { ListLoadingFooter } from "../../../src/components/ui/ListLoadingFooter";
import { SelectionTools } from "../../../src/components/bookmarks/SelectionTools";
import { FAB, FABDock } from "../../../src/components/ui/FAB";
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
import { layout, radius, spacing } from "../../../src/theme/tokens";
import { type BookmarkDto, type FolderDto } from "@ordo/shared";
import { openListBookmark } from "../../../src/lib/open-website";
import type { MenuAnchorRect } from "../../../src/lib/menu-anchor";
import { listPosition } from "../../../src/theme/list-shape";

type LibraryItem =
  | { type: "folder"; folder: FolderDto }
  | { type: "bookmark"; bookmark: BookmarkDto };

export default function BookmarksScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ bookmark?: string; focus?: string }>();
  const selectedBookmarkId = sanitizeRouteParam(params.bookmark);
  const { hasDetailPane } = useResponsiveLayout();
  const contentWidth = hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth;
   const { bottom: dockInset, selectionClearance, listOverlayClearance } = useFloatingDockMetrics();
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsAnchor, setToolsAnchor] = useState<MenuAnchorRect | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<MenuAnchorRect | null>(null);
  const [filterUnlock, setFilterUnlock] = useState<FolderDto | null>(null);
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

  const homeItems = useMemo(
    () => sortBookmarksBy(flattenPages(bookmarks.data?.pages ?? []), unfiledSort),
    [bookmarks.data, unfiledSort],
  );
   const search = useLibrarySearch(homeItems, folders.data ?? []);
  const items = search.active ? search.items : homeItems;
  const hasUnread = homeItems.some((bookmark) => !bookmark.isRead);
  const sortedFolders = useMemo(
    () => sortFoldersBy(folders.data ?? [], folderSort),
    [folders.data, folderSort],
  );
  const folderItems = useMemo(() => {
    if (!search.active) return sortedFolders;
    if (searchScopeActive(search.listFilters)) return [];
    const terms = search.trimmed.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return sortedFolders.filter((folder) => terms.every((term) => folder.name.toLocaleLowerCase().split(/\s+/).some((word) => word.startsWith(term))));
  }, [sortedFolders, search.active, search.trimmed, search.listFilters]);
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
    !search.active && ((folders.isPending && !folders.isError) || (bookmarks.isPending && !bookmarks.isError));
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
    deleteBookmark.mutate(bookmark, { onDeleted: () => { if (selectedBookmarkId === bookmark.id) router.setParams({ bookmark: "" }); } });
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
    await Promise.all([bookmarks.refetch(), folders.refetch(), tags.refetch(), ...(search.active ? [search.search.refetch()] : [])]);
  }, [bookmarks.refetch, folders.refetch, tags.refetch, resetPaging, search.active, search.search.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refreshAll);

  const openBookmark = useCallback((bookmark: BookmarkDto) => {
    openListBookmark(bookmark, () => {
      if (hasDetailPane) router.setParams({ bookmark: bookmark.id });
      else router.push(`/reader/${bookmark.id}`);
    });
  }, [router, hasDetailPane]);

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
  const toggleTag = useCallback((tagId: string) => search.setFilters((previous) => ({ ...previous,
    tagIds: previous.tagIds.includes(tagId) ? previous.tagIds.filter((id) => id !== tagId) : [...previous.tagIds, tagId] })), [search.setFilters]);
  const renderLibraryItem = useCallback(
    ({ item, index }: { item: LibraryItem; index: number }) => {
      if (item.type === "folder") {
        return (
          <FolderRow
            folder={item.folder}
            position={listPosition(index, folderItems.length)}
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
          position={listPosition(index - folderItems.length, items.length)}
          selectionMode={selectionActive}
          selected={selectionActive ? selectionRef.current.has(bookmarkKey(item.bookmark.id)) : hasDetailPane && item.bookmark.id === selectedBookmarkId}
          searchQuery={search.trimmed}
          searchFuzzy={search.listFilters.fuzzy}
          omitTagIds={search.listFilters.tagIds}
          onTagPress={search.active ? toggleTag : undefined}
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
       hasDetailPane, selectedBookmarkId, search.trimmed, search.listFilters.fuzzy, search.listFilters.tagIds, search.active, toggleTag,
       folderItems.length, items.length,
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
      paddingBottom: selection.active ? selectionClearance : listOverlayClearance,
    }),
    [selection.active, selectionClearance, listOverlayClearance],
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

  const createFab = !selection.active ? (
    <FABDock maxWidth={contentWidth}>
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
        label={createActionLabel(createButtonTapAction)}
        bottom={spacing[16]}
        right={hasDetailPane ? spacing[16] : undefined}
        maxContentWidth={contentWidth}
      />
    </FABDock>
  ) : null;

  const headerRight = (
    <HeaderActions>
      <HeaderIconButton name="ellipsis-horizontal" color={palette.onSurface}
        onPress={(anchor) => { setToolsAnchor(anchor); setToolsOpen(true); }} accessibilityLabel="Library actions" />
    </HeaderActions>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <LibraryHeader tools={headerRight} query={search.query} onQueryChange={search.setQuery}
        onFilter={(anchor) => { setFilterAnchor(anchor); setFilterOpen(true); }} filtersOn={search.filtersOn}
        autoFocusSearch={params.focus === "1"} maxWidth={contentWidth}
        resultLabel={search.active ? `${libraryItems.length}${search.search.hasNextPage ? "+" : ""} ${libraryItems.length === 1 ? "result" : "results"}` : undefined}
        filters={search.filtersOn ? <LibraryFilters filters={search.filters} folders={folders.data ?? []} tags={tags.data ?? []} onChange={search.setFilters} /> : undefined}
        selection={selection.active ? {
          count: selection.count,
          selectableCount: selectableKeys.length,
          onCancel: selection.exit,
          onToggleSelectAll: () => {
            if (selection.count === selectableKeys.length) selection.replace([]);
            else selection.replace(selectableKeys);
          },
        } : undefined} />

      <ExtractionProgressLine />

      {!search.active && bookmarks.error && !bookmarks.data && folderItems.length === 0 && !folders.isLoading ? (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load bookmarks"
            message={errorMessage(bookmarks.error)}
            action={<Button label="Retry" onPress={onRefresh} />}
          />
        </ScreenContent>
      ) : (
        <ScreenContent maxWidth={contentWidth} style={styles.content}>
          <View style={hasDetailPane ? styles.splitPane : styles.singlePane}>
          <View style={hasDetailPane ? styles.listPane : styles.singlePane}>
          <SelectionDragFrame drag={drag}>
          <ThemedFlashList
            ref={drag.listRef}
            onScroll={drag.onScroll}
            onContentSizeChange={drag.onContentSizeChange}
            scrollEventThrottle={drag.scrollEventThrottle}
            data={libraryLoading ? [] : libraryItems}
            extraData={`${selectionRevision}:${folderSort}:${unfiledSort}`}
            keyExtractor={libraryKeyExtractor}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={renderLibraryItem}
            ListEmptyComponent={
              libraryLoading ? (
                <BookmarkListSkeleton />
              ) : search.active ? (
                <View style={styles.emptyBookmarks}><EmptyState icon="search-outline"
                  title={search.searching ? "Searching…" : search.searchError ? "Couldn't search bookmarks" : "No results"}
                  message={search.searching ? "Checking the rest of your library…" : search.searchError ? errorMessage(search.searchError) : search.trimmed ? `No saved items match “${search.trimmed}”.` : "No bookmarks match these filters."}
                  action={search.searchError ? <Button label="Retry" onPress={() => search.search.refetch()} /> : undefined} /></View>
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
            ListFooterComponent={(search.active ? search.loadingMore : loadingMore) ? <ListLoadingFooter /> : null}
            contentContainerStyle={listContentStyle}
            refreshing={refreshing}
            onRefresh={onRefresh}
            scrollEnabled={drag.scrollEnabled}
            onEndReached={search.active ? search.onEndReached : onEndReached}
          />
          </SelectionDragFrame>
          {hasDetailPane ? createFab : null}
          </View>
          {hasDetailPane ? <View style={[styles.readerPane, { backgroundColor: palette.surfaceContainerLow }]}>
            {selectedBookmarkId ? <ReaderPane bookmarkId={selectedBookmarkId} embedded safeBottom={false} onBack={() => router.setParams({ bookmark: "" })} /> : <ReaderPanePlaceholder />}
          </View> : null}
          </View>
        </ScreenContent>
      )}

      {!hasDetailPane ? createFab : null}

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

      <ContextMenu visible={toolsOpen} onDismiss={() => setToolsOpen(false)} anchor={toolsAnchor}>
        <ContextMenuItem icon="swap-vertical-outline" label="Sort library" onPress={() => { setToolsOpen(false); setSortAnchor(toolsAnchor); setSortOpen(true); }} />
        {hasUnread ? <ContextMenuItem icon="checkmark-done" label="Mark all as read" onPress={() => { setToolsOpen(false); onMarkAllRead(); }} /> : null}
        <ContextMenuItem icon="pricetags-outline" label="Manage tags" detail={`${tagCount} ${tagCount === 1 ? "tag" : "tags"}`} onPress={() => { setToolsOpen(false); router.push("/tags"); }} />
      </ContextMenu>
      <SearchFilterMenu visible={filterOpen} onDismiss={() => setFilterOpen(false)} anchor={filterAnchor}
        tags={tags.data ?? []} folders={folders.data ?? []} filters={search.filters} onChange={search.setFilters}
        onUnlockFolder={(folder) => { setFilterOpen(false); setFilterUnlock(folder); }} />
      <LockPrompt visible={!!filterUnlock} folderId={filterUnlock?.id ?? ""} folderName={filterUnlock?.name}
        lockType={filterUnlock?.lockType} pinLength={filterUnlock?.pinLength} onDismiss={() => setFilterUnlock(null)}
        onUnlocked={() => { if (filterUnlock) search.setFilters((previous) => ({ ...previous, folderIds: [...new Set([...previous.folderIds, filterUnlock.id])] })); setFilterUnlock(null); }} />

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
        fromFolderId={moveTarget?.folderId ?? null}
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
  singlePane: { flex: 1, width: "100%" },
  splitPane: { flex: 1, flexDirection: "row", gap: spacing[16] },
  listPane: { width: "40%", minWidth: 320, flexShrink: 0 },
  readerPane: { flex: 1, minWidth: 0, overflow: "hidden", borderRadius: radius.xl },
});
