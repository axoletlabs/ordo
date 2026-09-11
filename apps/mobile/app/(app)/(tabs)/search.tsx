/**
 * Global bookmark search. Local word-prefix filter runs on the first keystroke;
 * the server catches up shortly after for article-body hits (five letters+).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "../../../src/components/ui/Header";
import { Spinner } from "../../../src/components/ui/Spinner";
import { SelectionHeader } from "../../../src/components/bookmarks/SelectionHeader";
import { SelectionTools } from "../../../src/components/bookmarks/SelectionTools";
import { BookmarkActionsSheet } from "../../../src/components/bookmarks/BookmarkActionsSheet";
import { MoveSheet } from "../../../src/components/bookmarks/MoveSheet";
import { EditTagsSheet } from "../../../src/components/tags/EditTagsSheet";
import { LockPrompt } from "../../../src/components/bookmarks/LockPrompt";
import { SearchFilterMenu } from "../../../src/components/bookmarks/SearchFilterMenu";
import { ScreenContent } from "../../../src/components/ui/ScreenContent";
import { ThemedFlashList } from "../../../src/components/ui/ThemedScrollView";
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
import { useFolders } from "../../../src/hooks/use-folders";
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
  reuseSearchResults,
  sanitizeRouteParam,
  searchFiltersActive,
  searchFiltersEqual,
  searchScopeActive,
  useDebouncedValue,
  useDeferredLayoutValue,
  type SearchFilters,
} from "../../../src/lib/search-bookmarks";
import { layout, radius, spacing } from "../../../src/theme/tokens";
import type { BookmarkDto, FolderDto } from "@ordo/shared";
import { openListBookmark } from "../../../src/lib/open-website";
import { estimateBookmarkRowSize } from "../../../src/lib/bookmark-row-layout";
import { registerSearchFieldFocus } from "../../../src/lib/search-field-focus";

const SERVER_DEBOUNCE_MS = 250;
const URL_SYNC_MS = 1000;
const EMPTY_BOOKMARKS: BookmarkDto[] = [];
/** Room for the result count + clear control so the TextInput width stays put. */
const SEARCH_FIELD_TAIL_PAD = 118;

/** Owns the field so keystrokes never wait on compiling or animating the list. */
const SearchField = React.memo(function SearchField({
  routeQuery,
  onQueryChange,
}: {
  routeQuery: string;
  onQueryChange: (query: string) => void;
}) {
  const { palette } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState(routeQuery);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const queryFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  useEffect(() => {
    // Expo Router echoes a lagged `query` param. Writing that back while the
    // field is focused drops later keystrokes ("hello" → "hel").
    if (focusedRef.current) return;
    setInput(routeQuery);
  }, [routeQuery]);

  useFocusEffect(
    useCallback(() => {
      return registerSearchFieldFocus(() => inputRef.current?.focus());
    }, []),
  );

  useEffect(
    () => () => {
      if (queryFrame.current != null) cancelAnimationFrame(queryFrame.current);
    },
    [],
  );

  const commit = (text: string) => {
    setInput(text);
    if (queryFrame.current != null) cancelAnimationFrame(queryFrame.current);
    // Let the focused TextInput finish its native layout before the list
    // swaps empty → dozens of rows. Updating both in the same event crashes.
    queryFrame.current = requestAnimationFrame(() => {
      queryFrame.current = null;
      onQueryChange(text);
    });
  };

  const trimmed = input.trim();
  const closeSearch = () => {
    haptics.light();
    inputRef.current?.blur();
    Keyboard.dismiss();
  };

  return (
    <Input
      ref={inputRef}
      value={input}
      onChangeText={commit}
      onFocus={() => {
        focusedRef.current = true;
        setFocused(true);
      }}
      onBlur={() => {
        focusedRef.current = false;
        setFocused(false);
      }}
      placeholder="Search bookmarks…"
      autoFocus={false}
      autoCorrect={false}
      spellCheck={false}
      autoCapitalize="none"
      returnKeyType="search"
      enablesReturnKeyAutomatically
      onSubmitEditing={() => Keyboard.dismiss()}
      containerStyle={styles.searchField}
      overlayRightAccessory
      overlayPaddingRight={SEARCH_FIELD_TAIL_PAD}
      icon={
        focused ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={6}
            onPress={closeSearch}
          >
            <Ionicons name="chevron-back" size={18} color={palette.text} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search bookmarks"
            hitSlop={6}
            onPress={() => inputRef.current?.focus()}
          >
            <Ionicons name="search-outline" size={18} color={palette.textTertiary} />
          </Pressable>
        )
      }
      rightAccessory={
        trimmed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => {
              haptics.light();
              commit("");
              inputRef.current?.focus();
            }}
          >
            <Ionicons name="close-circle" size={18} color={palette.textFaint} />
          </Pressable>
        ) : null
      }
    />
  );
});

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

  const [liveQuery, setLiveQuery] = useState(routeQuery);
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  // Menu/chips update immediately; FlashList waits a frame so it is not
  // recycling rows in the same native press that just changed the chip row.
  const listFilters = useDeferredLayoutValue(filters, searchFiltersEqual);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<MenuAnchorRect | null>(null);
  const [unlockFolder, setUnlockFolder] = useState<FolderDto | null>(null);
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
  const { data: allFolders } = useFolders();

  const trimmed = liveQuery.trim();
  const filtersOn = searchFiltersActive(filters);
  const listScopeOn = searchScopeActive(listFilters);
  const browsing = trimmed.length > 0 || listScopeOn;
  const serverQ = useDebouncedValue(trimmed, SERVER_DEBOUNCE_MS);
  const urlQuery = useDebouncedValue(trimmed, URL_SYNC_MS);
  const searchEnabled = serverQ.length > 0 || listScopeOn;

  const search = useInfiniteSearch(serverQ, {
    tagIds: listFilters.tagIds,
    folderIds: listFilters.folderIds,
    unfiled: listFilters.unfiled,
    unread: listFilters.status,
    fuzzy: listFilters.fuzzy,
    enabled: searchEnabled,
  });
  const serverItems = useMemo(() => {
    const pages = search.data?.pages;
    if (!pages?.length) return EMPTY_BOOKMARKS;
    return flattenPages(pages);
  }, [search.data]);
  const cachedItems = useMemo(() => {
    if (!browsing) return EMPTY_BOOKMARKS;
    return collectCachedBookmarks(queryClient);
  }, [browsing, queryClient, search.dataUpdatedAt]);
  const compiledItems = useMemo(() => {
    if (!browsing) return EMPTY_BOOKMARKS;
    try {
      return compileSearchResults({
        query: trimmed,
        filters: listFilters,
        serverItems,
        cachedItems,
        serverMatchesQuery: trimmed === serverQ,
      });
    } catch {
      return EMPTY_BOOKMARKS;
    }
  }, [browsing, cachedItems, listFilters, serverItems, serverQ, trimmed]);
  const itemsRef = useRef(EMPTY_BOOKMARKS);
  const items = reuseSearchResults(itemsRef.current, compiledItems);
  itemsRef.current = items;

  const selectedBookmarks = useMemo(
    () => items.filter((bookmark) => selection.has(bookmarkKey(bookmark.id))),
    [items, selection],
  );
  const selectableKeys = useMemo(() => items.map((bookmark) => bookmarkKey(bookmark.id)), [items]);
  const selectedTags = useMemo(
    () => (allTags ?? []).filter((tag) => filters.tagIds.includes(tag.id)),
    [allTags, filters.tagIds],
  );
  const selectedFolders = useMemo(
    () => (allFolders ?? []).filter((folder) => filters.folderIds.includes(folder.id)),
    [allFolders, filters.folderIds],
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
    setLiveQuery((current) => {
      if (current === routeQuery) return current;
      // Stale URL echo of an earlier prefix while the user kept typing.
      if (routeQuery && current.startsWith(routeQuery)) return current;
      return routeQuery;
    });
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

  const selectionActive = selection.active;
  const selectionRevision = selection.revision;
  const renderBookmark = useCallback(
    ({ item }: { item: BookmarkDto }) => (
      <BookmarkRow
        bookmark={item}
        searchQuery={trimmed}
        searchFuzzy={listFilters.fuzzy}
        selectionMode={selectionActive}
        selected={
          selectionActive
            ? selectionRef.current.has(bookmarkKey(item.id))
            : hasDetailPane && item.id === selectedBookmarkId
        }
        omitTagIds={listFilters.tagIds}
        onPress={onPressBookmark}
        onEnterSelection={onEnterSelection}
        onMore={onMoreBookmark}
        onTagPress={toggleTag}
      />
    ),
    [
      hasDetailPane,
      listFilters.fuzzy,
      listFilters.tagIds,
      onEnterSelection,
      onMoreBookmark,
      onPressBookmark,
      selectedBookmarkId,
      selectionActive,
      selectionRevision,
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
  const listContentStyle = useMemo(
    () => ({ paddingBottom: listContentPadding }),
    [listContentPadding],
  );

  const empty = !browsing ? (
    <EmptyState
      icon="search-outline"
      title="Search your library"
      message="Type the start of a title, site, or URL. Every word is required first; looser matches follow. Article text after five letters."
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
            ? `Nothing starts with “${trimmed}”.`
            : "Nothing matches these filters."
      }
    />
  ) : null;

  const overrideItemLayout = useCallback((layout: { size?: number }, item: BookmarkDto) => {
    if (!item) {
      layout.size = 72;
      return;
    }
    try {
      layout.size = estimateBookmarkRowSize(item);
    } catch {
      layout.size = 72;
    }
  }, []);

  const listPane = (
    <ThemedFlashList
      data={items}
      extraData={`${selectionRevision}:${selectedBookmarkId ?? ""}:${trimmed}:${listFilters.tagIds.join(",")}:${listFilters.folderIds.join(",")}:${listFilters.unfiled}:${listFilters.status}:${listFilters.kind}:${listFilters.fuzzy}`}
      keyExtractor={(b: BookmarkDto) => b.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      estimatedItemSize={72}
      overrideItemLayout={overrideItemLayout}
      renderItem={renderBookmark}
      ListEmptyComponent={empty ? <View style={styles.emptyList}>{empty}</View> : null}
      ListFooterComponent={
        search.isFetchingNextPage ? (
          <View style={styles.footer}>
            <Spinner color={palette.accent} />
          </View>
        ) : null
      }
      contentContainerStyle={listContentStyle}
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
            <View style={styles.searchFieldWrap}>
              <SearchField
                routeQuery={routeQuery}
                onQueryChange={setLiveQuery}
              />
              {resultMeta || (search.isFetching && browsing && !trimmed) ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.fieldOverlay,
                    { right: trimmed ? spacing[12] + 18 + spacing[8] : spacing[12] },
                  ]}
                >
                  {resultMeta ? (
                    <Text variant="caption" color="tertiary" numberOfLines={1} style={styles.resultLabel}>
                      {resultMeta}
                    </Text>
                  ) : (
                    <Spinner size="sm" color={palette.textTertiary} />
                  )}
                </View>
              ) : null}
            </View>
            <View ref={filterRef} collapsable={false}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Search filters"
                accessibilityState={{ expanded: filterOpen }}
                accessibilityHint="Filter by folder, tag, read status, or type"
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

          {filtersOn ? (
            <View style={styles.metaRow}>
              {selectedFolders.map((folder) => (
                <TagChip
                  key={folder.id}
                  name={folder.name}
                  color="slate"
                  selected
                  compact
                  onPress={() =>
                    setFilters((prev) => ({
                      ...prev,
                      folderIds: prev.folderIds.filter((id) => id !== folder.id),
                    }))
                  }
                  accessibilityLabel={`Remove ${folder.name} folder filter`}
                />
              ))}
              {filters.unfiled ? (
                <TagChip
                  name="Unfiled"
                  color="slate"
                  selected
                  compact
                  onPress={() => setFilters((prev) => ({ ...prev, unfiled: false }))}
                  accessibilityLabel="Clear unfiled filter"
                />
              ) : null}
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
              {filters.fuzzy ? (
                <TagChip
                  name="Fuzzy"
                  color="slate"
                  selected
                  compact
                  onPress={() => setFilters((prev) => ({ ...prev, fuzzy: false }))}
                  accessibilityLabel="Turn off fuzzy matching"
                />
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
        folders={allFolders ?? []}
        filters={filters}
        onChange={setFilters}
        onUnlockFolder={(folder) => {
          setFilterOpen(false);
          setUnlockFolder(folder);
        }}
      />
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
          if (!folder) return;
          setFilters((prev) =>
            prev.folderIds.includes(folder.id)
              ? prev
              : { ...prev, folderIds: [...prev.folderIds, folder.id] },
          );
        }}
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
  searchWrap: { width: "100%", paddingBottom: spacing[6] },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  searchFieldWrap: { flex: 1, minWidth: 0 },
  searchField: { flex: 1, minWidth: 0 },
  fieldOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  resultLabel: { flexShrink: 1, maxWidth: 92 },
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
    paddingTop: spacing[8],
  },
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
