/**
 * Tag browse: whole-library bookmark list for one tag. Other tags stay on
 * each row (except the one you are already viewing) and open that tag.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedFlashList } from "../../../src/components/ui/ThemedScrollView";
import { Spinner } from "../../../src/components/ui/Spinner";
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
import { BookmarkActionsSheet } from "../../../src/components/bookmarks/BookmarkActionsSheet";
import { MoveSheet } from "../../../src/components/bookmarks/MoveSheet";
import { EditTagsSheet } from "../../../src/components/tags/EditTagsSheet";
import { TagActionsSheet } from "../../../src/components/tags/TagActionsSheet";
import { ReaderPane, ReaderPanePlaceholder } from "../../../src/components/reader/ReaderPane";
import { useTags, useTaggedBookmarks } from "../../../src/hooks/use-tags";
import {
  useToggleRead,
  useDeleteBookmark,
} from "../../../src/hooks/use-bookmarks";
import { useResponsiveLayout } from "../../../src/hooks/use-responsive-layout";
import { bookmarkKey, useSelectionMode } from "../../../src/hooks/use-selection";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { haptics } from "../../../src/lib/haptics";
import { errorMessage } from "../../../src/lib/error-message";
import { flattenPages } from "../../../src/lib/api/query-keys";
import { layout, radius, spacing } from "../../../src/theme/tokens";
import type { BookmarkDto } from "@ordo/shared";
import { openListBookmark } from "../../../src/lib/open-website";
import { estimateBookmarkRowSize } from "../../../src/lib/bookmark-row-layout";
import type { MenuAnchorRect } from "../../../src/lib/menu-anchor";

export default function TagDetailScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { hasDetailPane } = useResponsiveLayout();
  const { bottom: dockInset, selectionClearance } = useFloatingDockMetrics();
  const { id, bookmark } = useLocalSearchParams<{ id: string; bookmark?: string }>();
  const routeId = Array.isArray(id) ? id[0] : id;
  const selectedBookmarkId = Array.isArray(bookmark) ? bookmark[0] : bookmark;

  const { data: tags } = useTags();
  const anchor = useMemo(() => tags?.find((t) => t.id === routeId), [tags, routeId]);
  const activeIds = useMemo(() => (routeId ? [routeId] : []), [routeId]);

  const list = useTaggedBookmarks(activeIds, !!routeId);
  const toggleRead = useToggleRead(null);
  const deleteBm = useDeleteBookmark(null);

  const [addOpen, setAddOpen] = useState(false);
  const [actionBm, setActionBm] = useState<BookmarkDto | null>(null);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<MenuAnchorRect | null>(null);
  const [moveTarget, setMoveTarget] = useState<BookmarkDto | null>(null);
  const [editTagsBm, setEditTagsBm] = useState<BookmarkDto | null>(null);
  const [tagActionsOpen, setTagActionsOpen] = useState(false);
  const [tagAnchor, setTagAnchor] = useState<MenuAnchorRect | null>(null);
  const selection = useSelectionMode();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const items = useMemo(() => flattenPages(list.data?.pages ?? []), [list.data]);
  const selectedBookmarks = useMemo(
    () => items.filter((bookmark) => selection.has(bookmarkKey(bookmark.id))),
    [items, selection],
  );
  const selectableKeys = useMemo(() => items.map((bookmark) => bookmarkKey(bookmark.id)), [items]);

  const openReader = useCallback((b: BookmarkDto) => {
    openListBookmark(b, () => {
      if (hasDetailPane) {
        router.push({
          pathname: "/tags/[id]",
          params: { id: routeId ?? "", bookmark: b.id },
        });
        return;
      }
      router.push(`/reader/${b.id}`);
    });
  }, [hasDetailPane, routeId, router]);

  const onPressBookmark = useCallback((bookmark: BookmarkDto) => {
    const sel = selectionRef.current;
    if (sel.active) sel.toggle(bookmarkKey(bookmark.id));
    else openReader(bookmark);
  }, [openReader]);

  const onMoreBookmark = useCallback((b: BookmarkDto, menuAnchor: MenuAnchorRect) => {
    setBookmarkAnchor(menuAnchor);
    setActionBm(b);
  }, []);

  const onEnterSelection = useCallback((bookmark: BookmarkDto) => {
    selectionRef.current.enter(bookmarkKey(bookmark.id));
  }, []);

  const onToggleRead = (b: BookmarkDto) => {
    haptics.light();
    toggleRead.mutate({ id: b.id, isRead: !b.isRead });
  };

  const onDelete = (b: BookmarkDto) => {
    haptics.medium();
    deleteBm.mutate(b, {
      onDeleted: () => {
        if (selectedBookmarkId === b.id) {
          router.replace({ pathname: "/tags/[id]", params: { id: routeId ?? "" } });
        }
      },
    });
  };

  const loadMore = () => {
    if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
  };

  const onTagPress = useCallback((tagId: string) => {
    if (selectionRef.current.active) return;
    haptics.light();
    router.replace(`/tags/${tagId}`);
  }, [router]);

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
        omitTagIds={activeIds}
        onTagPress={onTagPress}
      />
    ),
    [
      activeIds,
      hasDetailPane,
      onEnterSelection,
      onMoreBookmark,
      onPressBookmark,
      onTagPress,
      selectedBookmarkId,
      selectionActive,
      selectionRevision,
    ],
  );
  const overrideItemLayout = useCallback((layout: { size?: number }, item: BookmarkDto) => {
    layout.size = estimateBookmarkRowSize(item);
  }, []);

  const listPane = (
    <ThemedFlashList
      data={items}
      extraData={`${selectionRevision}:${selectedBookmarkId ?? ""}`}
      keyExtractor={(b: BookmarkDto) => b.id}
      renderItem={renderBookmark}
      estimatedItemSize={72}
      overrideItemLayout={overrideItemLayout}
      contentContainerStyle={{
        paddingBottom: selection.active ? selectionClearance : spacing[96],
      }}
      refreshing={list.isFetching && !list.isFetchingNextPage}
      onRefresh={() => list.refetch()}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        list.isFetchingNextPage ? (
          <View style={styles.footer}>
            <Spinner color={palette.accent} />
          </View>
        ) : null
      }
    />
  );

  if (!routeId) return null;

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
        title={anchor?.name ?? "Tag"}
        subtitle={
          anchor
            ? `${anchor.bookmarkCount} ${anchor.bookmarkCount === 1 ? "bookmark" : "bookmarks"}`
            : undefined
        }
        showBack
        maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
        right={
          anchor ? (
            <HeaderActions>
              <HeaderIconButton
                name="ellipsis-horizontal"
                color={palette.text}
                onPress={(menuAnchor) => {
                  setTagAnchor(menuAnchor);
                  setTagActionsOpen(true);
                }}
                accessibilityLabel="Tag actions"
              />
            </HeaderActions>
          ) : undefined
        }
      />
      )}

      <ExtractionProgressLine maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth} />

      {list.error && !list.data ? (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load bookmarks"
            message={errorMessage(list.error)}
            action={<Button label="Retry" onPress={() => list.refetch()} />}
          />
        </ScreenContent>
      ) : items.length === 0 && !list.isLoading ? (
        <ScreenContent maxWidth={layout.maxContentWidth} style={styles.center}>
          <EmptyState
            icon="pricetag-outline"
            title="No bookmarks with this tag"
            message="Save a bookmark with this tag, or pick another."
          />
        </ScreenContent>
      ) : list.isLoading ? (
        <ScreenContent
          maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
          style={styles.content}
        >
          <BookmarkListSkeleton />
        </ScreenContent>
      ) : hasDetailPane ? (
        <ScreenContent maxWidth={layout.maxLibraryWidth} style={styles.content}>
          <View style={styles.splitPane}>
            <View style={styles.listPane}>{listPane}</View>
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

      {selection.active ? null : (
      <FABLayer maxWidth={layout.maxContentWidth}>
        <FAB
          onPress={() => setAddOpen(true)}
          accessibilityLabel="Save bookmark"
          accessibilityHint="Tap to save a bookmark."
          right={spacing[20]}
        />
      </FABLayer>
      )}

      <AddBookmarkSheet
        visible={addOpen}
        onDismiss={() => setAddOpen(false)}
        folderId={null}
        allowFolderSelection
        initialTagIds={activeIds}
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
        onMove={setMoveTarget}
        onDelete={onDelete}
        onEditTags={setEditTagsBm}
      />

      <MoveSheet
        visible={!!moveTarget}
        bookmark={moveTarget}
        fromFolderId={moveTarget?.folderId ?? null}
        onDismiss={() => setMoveTarget(null)}
      />

      <EditTagsSheet
        visible={!!editTagsBm}
        bookmark={editTagsBm}
        onDismiss={() => setEditTagsBm(null)}
      />

      <TagActionsSheet
        visible={tagActionsOpen}
        tag={anchor ?? null}
        anchor={tagAnchor}
        onDismiss={() => {
          setTagActionsOpen(false);
          setTagAnchor(null);
        }}
        onDeleted={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/tags");
        }}
      />
      <SelectionTools
        active={selection.active}
        bookmarks={selectedBookmarks}
        fromFolderId={null}
        onFinished={() => {
          if (hasDetailPane && selectedBookmarkId && selection.has(bookmarkKey(selectedBookmarkId))) {
            router.replace({ pathname: "/tags/[id]", params: { id: routeId ?? "" } });
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
