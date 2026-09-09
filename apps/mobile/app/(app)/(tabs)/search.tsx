/**
 * Global bookmark search. Local substring filter runs on the first keystroke;
 * the server catches up shortly after for article-body hits.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "../../../src/components/ui/Header";
import { SelectionHeader } from "../../../src/components/bookmarks/SelectionHeader";
import { SelectionTools } from "../../../src/components/bookmarks/SelectionTools";
import { BookmarkActionsSheet } from "../../../src/components/bookmarks/BookmarkActionsSheet";
import { MoveSheet } from "../../../src/components/bookmarks/MoveSheet";
import { EditTagsSheet } from "../../../src/components/tags/EditTagsSheet";
import { SearchFilterMenu } from "../../../src/components/bookmarks/SearchFilterMenu";
import { ScreenContent } from "../../../src/components/ui/ScreenContent";
import { ThemedAnimatedFlatList } from "../../../src/components/ui/ThemedScrollView";
import { Input } from "../../../src/components/ui/Input";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Button } from "../../../src/components/ui/Button";
import { Text } from "../../../src/components/ui/Text";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { BookmarkRow } from "../../../src/components/bookmarks/BookmarkRow";
import { ExtractionProgressLine } from "../../../src/components/bookmarks/ExtractionProgressLine";
import { TagChip } from "../../../src/components/tags/TagChip";
import { ReaderPane, ReaderPanePlaceholder } from "../../../src/components/reader/ReaderPane";
import { useInfiniteSearch, useToggleRead, useDeleteBookmark } from "../../../src/hooks/use-bookmarks";
import { bookmarkKey, useSelectionMode } from "../../../src/hooks/use-selection";
import { useTags } from "../../../src/hooks/use-tags";
import { useResponsiveLayout } from "../../../src/hooks/use-responsive-layout";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { flattenPages } from "../../../src/lib/api/query-keys";
import { collectCachedBookmarks } from "../../../src/lib/cache-helpers";
import { errorMessage } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { measureAnchor, type MenuAnchorRect } from "../../../src/lib/menu-anchor";
import {
  compileSearchResults,
  EMPTY_SEARCH_FILTERS,
  sanitizeRouteParam,
  searchFiltersActive,
  useDebouncedValue,
  type SearchFilters,
} from "../../../src/lib/search-bookmarks";
import { layout, radius, spacing } from "../../../src/theme/tokens";
import type { BookmarkDto } from "@ordo/shared";
import { openListBookmark } from "../../../src/lib/open-website";

const SERVER_DEBOUNCE_MS = 200;
const URL_SYNC_MS = 1000;

export default function SearchScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ query?: string; bookmark?: string }>();
  const { hasDetailPane } = useResponsiveLayout();
  const {
    visible: floatingNavigation,
    sideNavigation,
    clearance: bottomClearance,
    bottom: dockInset,
    selectionClearance,
  } = useFloatingDockMetrics();

  const routeQuery = sanitizeRouteParam(params.query);
  const selectedBookmarkId = sanitizeRouteParam(params.bookmark) || undefined;
  const appliedRouteQuery = useRef(routeQuery);

  const [input, setInput] = useState(routeQuery);
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<MenuAnchorRect | null>(null);
  const [actionBm, setActionBm] = useState<BookmarkDto | null>(null);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<MenuAnchorRect | null>(null);
  const [moveTarget, setMoveTarget] = useState<BookmarkDto | null>(null);
  const [editTagsBm, setEditTagsBm] = useState<BookmarkDto | null>(null);
  const filterRef = useRef<View>(null);
  const selection = useSelectionMode();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const toggleRead = useToggleRead(null);
  const deleteBm = useDeleteBookmark(null);
  const { data: allTags } = useTags();

  const trimmed = input.trim();
  const filtersOn = searchFiltersActive(filters);
  const browsing = trimmed.length > 0 || filtersOn;
  const serverQ = useDebouncedValue(trimmed, trimmed.length <= 1 ? 0 : SERVER_DEBOUNCE_MS);
  const urlQuery = useDebouncedValue(trimmed, URL_SYNC_MS);
  const searchEnabled = serverQ.length > 0 || filtersOn;

  const search = useInfiniteSearch(serverQ, filters.tagIds, filters.status, searchEnabled);
  const serverItems = useMemo(() => flattenPages(search.data?.pages ?? []), [search.data]);
  const cachedItems = useMemo(() => {
    if (!browsing) return [];
    return collectCachedBookmarks(queryClient);
  }, [browsing, queryClient, search.dataUpdatedAt]);
  const items = useMemo(() => {
    if (!browsing) return [];
    return compileSearchResults({
      query: trimmed,
      filters,
      serverItems,
      cachedItems,
      // Placeholder pages belong to the previous query key. Trusting them as
      // body-only hits skipped the typed haystack (tag filter + unrelated text).
      serverMatchesQuery: trimmed === serverQ && !search.isPlaceholderData,
    });
  }, [browsing, cachedItems, filters, search.isPlaceholderData, serverItems, serverQ, trimmed]);

  const selectedBookmarks = useMemo(
    () => items.filter((bookmark) => selection.has(bookmarkKey(bookmark.id))),
    [items, selection],
  );
  const selectableKeys = useMemo(() => items.map((bookmark) => bookmarkKey(bookmark.id)), [items]);
  const selectedTags = useMemo(
    () => (allTags ?? []).filter((tag) => filters.tagIds.includes(tag.id)),
    [allTags, filters.tagIds],
  );

  useEffect(() => {
    const rawQuery = Array.isArray(params.query) ? params.query[0] : params.query;
    const rawBookmark = Array.isArray(params.bookmark) ? params.bookmark[0] : params.bookmark;
    if (rawQuery === "undefined" || rawQuery === "null" || rawBookmark === "undefined" || rawBookmark === "null") {
      router.setParams({ query: "", bookmark: "" });
    }
  }, [params.bookmark, params.query, router]);

  useEffect(() => {
    if (routeQuery === appliedRouteQuery.current) return;
    appliedRouteQuery.current = routeQuery;
    setInput(routeQuery);
  }, [routeQuery]);

  useEffect(() => {
    if (urlQuery === appliedRouteQuery.current) return;
    appliedRouteQuery.current = urlQuery;
    router.setParams({ query: urlQuery });
  }, [router, urlQuery]);

  const clearBookmarkParam = useCallback(() => {
    router.setParams({ bookmark: "" });
  }, [router]);

  const openReader = useCallback((b: BookmarkDto) => {
    openListBookmark(b, () => {
      if (hasDetailPane) {
        router.setParams({ bookmark: b.id });
        return;
      }
      router.push(`/reader/${b.id}`);
    });
  }, [hasDetailPane, router]);

  const onPressBookmark = useCallback((bookmark: BookmarkDto) => {
    const sel = selectionRef.current;
    if (sel.active) sel.toggle(bookmarkKey(bookmark.id));
    else openReader(bookmark);
  }, [openReader]);

  const onMoreBookmark = useCallback((bookmark: BookmarkDto, menuAnchor: MenuAnchorRect) => {
    setBookmarkAnchor(menuAnchor);
    setActionBm(bookmark);
  }, []);

  const onEnterSelection = useCallback((bookmark: BookmarkDto) => {
    selectionRef.current.enter(bookmarkKey(bookmark.id));
  }, []);

  const toggleTag = useCallback((tagId: string) => {
    if (selectionRef.current.active) return;
    haptics.selection();
    setFilters((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
  }, []);

  const onToggleRead = (bookmark: BookmarkDto) => {
    haptics.light();
    toggleRead.mutate({ id: bookmark.id, isRead: !bookmark.isRead });
  };

  const onDelete = (bookmark: BookmarkDto) => {
    haptics.medium();
    deleteBm.mutate(bookmark, {
      onDeleted: () => {
        if (selectedBookmarkId === bookmark.id) clearBookmarkParam();
      },
    });
  };

  const openFilters = useCallback((event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    haptics.selection();
    Keyboard.dismiss();
    measureAnchor(filterRef.current, (anchor) => {
      setFilterAnchor(anchor);
      setFilterOpen(true);
    }, event);
  }, []);

  const renderBookmark = useCallback(
    ({ item }: { item: BookmarkDto }) => (
      <BookmarkRow
        bookmark={item}
        searchQuery={trimmed}
        selectionMode={selection.active}
        selected={
          selection.active
            ? selection.has(bookmarkKey(item.id))
            : hasDetailPane && item.id === selectedBookmarkId
        }
        omitTagIds={filters.tagIds}
        onPress={onPressBookmark}
        onEnterSelection={onEnterSelection}
        onMore={onMoreBookmark}
        onTagPress={toggleTag}
      />
    ),
    [
      filters.tagIds,
      hasDetailPane,
      onEnterSelection,
      onMoreBookmark,
      onPressBookmark,
      selectedBookmarkId,
      selection,
      toggleTag,
      trimmed,
    ],
  );

  const listContentPadding = selection.active
    ? selectionClearance
    : floatingNavigation
      ? bottomClearance
      : sideNavigation
        ? spacing[32]
        : spacing[96];

  const empty = !browsing ? (
    <EmptyState
      icon="search-outline"
      title="Search your library"
      message="Type any part of a title, URL, or tag. Every word you type has to appear."
    />
  ) : search.error && items.length === 0 ? (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn't search bookmarks"
      message={errorMessage(search.error)}
      action={<Button label="Retry" onPress={() => search.refetch()} />}
    />
  ) : items.length === 0 && search.isFetching && cachedItems.length === 0 && serverItems.length === 0 ? (
    <EmptyState icon="search-outline" title="Searching…" message="Matching titles, URLs, and articles." />
  ) : items.length === 0 ? (
    <EmptyState
      icon="document-text-outline"
      title="No results"
      message={
        trimmed && filtersOn
          ? `Nothing matches “${trimmed}” with these filters.`
          : trimmed
            ? `Nothing contains “${trimmed}”.`
            : "Nothing matches these filters."
      }
    />
  ) : null;

  const listPane = (
    <ThemedAnimatedFlatList
      data={items}
      extraData={`${selection.revision}:${selectedBookmarkId ?? ""}:${trimmed}:${filters.tagIds.join(",")}:${filters.status}:${filters.kind}`}
      keyExtractor={(b: BookmarkDto) => b.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      renderItem={renderBookmark}
      ListEmptyComponent={empty ? <View style={styles.emptyList}>{empty}</View> : null}
      ListFooterComponent={
        search.isFetchingNextPage ? (
          <View style={styles.footer}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : null
      }
      contentContainerStyle={{ paddingBottom: listContentPadding }}
      onEndReached={() => {
        if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
    />
  );

  const resultMeta = browsing && items.length > 0
    ? `${items.length}${search.hasNextPage ? "+" : ""} ${items.length === 1 ? "result" : "results"}`
    : null;

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
          title="Search"
          large
          maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
        />
      )}
      <ExtractionProgressLine maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth} />
      <ScreenContent
        maxWidth={hasDetailPane ? layout.maxLibraryWidth : layout.maxContentWidth}
        style={styles.content}
      >
        <View style={styles.searchWrap}>
          <View style={styles.searchRow}>
            <Input
              value={input}
              onChangeText={setInput}
              placeholder="Search bookmarks…"
              autoFocus={false}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              enablesReturnKeyAutomatically
              onSubmitEditing={() => Keyboard.dismiss()}
              containerStyle={styles.searchField}
              icon={<Ionicons name="search-outline" size={18} color={palette.textTertiary} />}
              rightAccessory={
                trimmed ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={8}
                    scaleTo={0.85}
                    onPress={() => {
                      haptics.light();
                      setInput("");
                    }}
                  >
                    <Ionicons name="close-circle" size={18} color={palette.textFaint} />
                  </PressableScale>
                ) : search.isFetching && browsing ? (
                  <ActivityIndicator size="small" color={palette.textTertiary} />
                ) : null
              }
            />
            <View ref={filterRef} collapsable={false}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Search filters"
                accessibilityState={{ expanded: filterOpen }}
                accessibilityHint="Filter by tag, read status, or type"
                hitSlop={4}
                scaleTo={0.92}
                onPress={(event) => openFilters(event)}
                style={[
                  styles.filterBtn,
                  {
                    borderColor: filtersOn || filterOpen ? palette.accent : palette.border,
                    backgroundColor: palette.background,
                  },
                ]}
              >
                <Ionicons
                  name="filter-outline"
                  size={18}
                  color={filtersOn || filterOpen ? palette.accent : palette.textTertiary}
                />
                {filtersOn ? <View style={[styles.filterDot, { backgroundColor: palette.accent }]} /> : null}
              </PressableScale>
            </View>
          </View>

          {filtersOn || resultMeta ? (
            <View style={styles.metaRow}>
              {selectedTags.map((tag) => (
                <TagChip
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  selected
                  compact
                  onPress={() => toggleTag(tag.id)}
                  accessibilityLabel={`Remove ${tag.name} filter`}
                />
              ))}
              {filters.status !== "all" ? (
                <TagChip
                  name={filters.status === "unread" ? "Unread" : "Read"}
                  color="slate"
                  selected
                  compact
                  onPress={() => setFilters((prev) => ({ ...prev, status: "all" }))}
                  accessibilityLabel="Clear status filter"
                />
              ) : null}
              {filters.kind !== "all" ? (
                <TagChip
                  name={filters.kind === "article" ? "Articles" : "Websites"}
                  color="slate"
                  selected
                  compact
                  onPress={() => setFilters((prev) => ({ ...prev, kind: "all" }))}
                  accessibilityLabel="Clear type filter"
                />
              ) : null}
              {resultMeta ? (
                <Text variant="caption" color="tertiary" style={styles.resultCount}>
                  {resultMeta}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {hasDetailPane ? (
          <View style={styles.splitPane}>
            <View style={styles.listPane}>{listPane}</View>
            <View style={[styles.readerPane, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              {selectedBookmarkId ? (
                <ReaderPane
                  bookmarkId={selectedBookmarkId}
                  embedded
                  safeBottom={false}
                  onBack={clearBookmarkParam}
                />
              ) : (
                <ReaderPanePlaceholder />
              )}
            </View>
          </View>
        ) : (
          <View style={styles.singlePane}>{listPane}</View>
        )}
      </ScreenContent>

      <SearchFilterMenu
        visible={filterOpen}
        onDismiss={() => setFilterOpen(false)}
        anchor={filterAnchor}
        tags={allTags ?? []}
        filters={filters}
        onChange={setFilters}
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
      <EditTagsSheet
        visible={!!editTagsBm}
        bookmark={editTagsBm}
        onDismiss={() => setEditTagsBm(null)}
      />
      <MoveSheet
        visible={!!moveTarget}
        bookmark={moveTarget}
        fromFolderId={moveTarget?.folderId ?? null}
        onDismiss={() => setMoveTarget(null)}
      />
      <SelectionTools
        active={selection.active}
        bookmarks={selectedBookmarks}
        fromFolderId={null}
        onFinished={() => {
          if (hasDetailPane && selectedBookmarkId && selection.has(bookmarkKey(selectedBookmarkId))) {
            clearBookmarkParam();
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
  searchWrap: { width: "100%", paddingBottom: spacing[8], gap: spacing[8] },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  searchField: { flex: 1, minWidth: 0 },
  filterBtn: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  filterDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[6],
  },
  resultCount: { marginLeft: "auto" },
  emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center", minHeight: 280 },
  footer: { paddingVertical: spacing[20], alignItems: "center" },
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
});
