/** Immediate cached matches, followed by paginated server/article-body matches. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { prepareBookmarkSearch, type BookmarkDto, type FolderDto } from "@ordo/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { bookmarksApi } from "../lib/api/bookmarks";
import { flattenPages, nextPageCursor, qk } from "../lib/api/query-keys";
import { LIST_PAGE_SIZE } from "../lib/list-pagination";
import { useFolderTokenStore } from "../store/folder-tokens";
import { useInfiniteSearch } from "./use-bookmarks";
import { useLoadMore } from "./use-list-controls";
import { collectCachedBookmarks } from "../lib/cache-helpers";
import { compileSearchResults, EMPTY_SEARCH_FILTERS, reuseSearchResults, sanitizeRouteParam,
   searchFiltersActive, searchScopeActive, useDebouncedValue,
  type SearchFilters } from "../lib/search-bookmarks";

const EMPTY: BookmarkDto[] = [];
/** Let the visible library and launch requests finish before indexing the rest. */
const CATALOGUE_WARM_DELAY_MS = 2_000;

/**
 * Warms the lean, authorized metadata catalogue progressively so typing never
 * waits for a request, even for folders the user has not opened. Mount it as
 * its own component: each page re-renders only this hook, not the library.
 * Search reads the pages through the query cache (collectCachedBookmarks).
 */
export function useLibraryCatalogue(searching: boolean) {
  const accessRevision = useFolderTokenStore((state) => state.accessRevision);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), CATALOGUE_WARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  const catalogue = useInfiniteQuery({
    queryKey: qk.libraryIndex(accessRevision),
    queryFn: ({ pageParam }) => bookmarksApi.listTagged([], pageParam, LIST_PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (page, _pages, _lastParam, pageParams) => {
      const next = nextPageCursor(page);
      return next && !pageParams.includes(next) ? next : undefined;
    }, staleTime: 60_000,
    enabled: armed || searching,
  });
  useEffect(() => {
    for (const bookmark of catalogue.data?.pages.at(-1)?.items ?? []) prepareBookmarkSearch(bookmark);
  }, [catalogue.data]);
  useEffect(() => {
    if (!catalogue.hasNextPage || catalogue.isFetching || catalogue.isError) return;
    const timer = setTimeout(() => void catalogue.fetchNextPage(), 250);
    return () => clearTimeout(timer);
  }, [catalogue.hasNextPage, catalogue.isFetching, catalogue.isError, catalogue.data, catalogue.fetchNextPage]);
}

export function useLibrarySearch(localItems: readonly BookmarkDto[], folders: readonly FolderDto[]) {
  const router = useRouter();
  const params = useLocalSearchParams<{ query?: string }>();
  const routeQuery = sanitizeRouteParam(params.query);
  const appliedRouteQuery = useRef(routeQuery);
  const [query, setQuery] = useState(routeQuery);
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const listFilters = filters;
  const trimmed = query.trim();
  const active = trimmed.length > 0 || searchScopeActive(listFilters);
  const filtersOn = searchFiltersActive(filters);
  const serverQuery = useDebouncedValue(trimmed, trimmed.length <= 3 ? 180 : 90);
  const urlQuery = useDebouncedValue(trimmed, 1000);
  const queryClient = useQueryClient();
  const accessRevision = useFolderTokenStore((state) => state.accessRevision);
  useEffect(() => {
    for (const bookmark of localItems) prepareBookmarkSearch(bookmark);
  }, [localItems]);
  const [cacheRevision, setCacheRevision] = useState(0);
  // Cached matches are only computed while searching; idle, cache traffic
  // (catalogue pages, polls, prefetches) must not re-render the library.
  useEffect(() => {
    if (!active) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "bookmarks") return;
      // Search pages are written by this hook's own query; recomputing the
      // cached-match snapshot on each would be redundant work per page.
      if (event.query.queryKey[1] === "search") return;
      if (event.type === "removed" || (event.type === "updated" && event.action.type === "success"))
        setCacheRevision((revision) => revision + 1);
    });
  }, [queryClient, active]);
  const search = useInfiniteSearch(serverQuery, { tagIds: listFilters.tagIds, folderIds: listFilters.folderIds,
    unfiled: listFilters.unfiled, unread: listFilters.status, fuzzy: listFilters.fuzzy,
    reminder: listFilters.reminder, enabled: !!serverQuery || searchScopeActive(listFilters) });
  const serverItems = useMemo(() => flattenPages(search.data?.pages ?? []), [search.data]);
  const publicFolderIds = useMemo(() => new Set(folders.filter((folder) => !folder.protected).map((folder) => folder.id)), [folders]);
  const visible = useCallback((bookmark: BookmarkDto) => !bookmark.folderId || publicFolderIds.has(bookmark.folderId) ||
    !!useFolderTokenStore.getState().get(bookmark.folderId), [publicFolderIds, accessRevision]);
  const cachedItems = useMemo(() => active ? [...localItems, ...collectCachedBookmarks(queryClient)].filter(visible) : EMPTY,
    // Access changes invalidate old cached rows immediately, not after a refetch.
    [active, localItems, queryClient, cacheRevision, visible]);
  const compiled = useMemo(() => active ? compileSearchResults({ query: trimmed, filters: listFilters, serverItems,
    cachedItems, serverMatchesQuery: trimmed === serverQuery }).filter(visible) : EMPTY,
    [active, trimmed, listFilters, serverItems, cachedItems, serverQuery, visible]);
  const previous = useRef(EMPTY);
  const items = reuseSearchResults(previous.current, compiled);
  previous.current = items;
  const currentServerQuery = trimmed === serverQuery;
  const searching = active && (!currentServerQuery || search.isFetching);
  const searchError = currentServerQuery ? search.error : null;
  const paging = useLoadMore({ hasNextPage: currentServerQuery && !!search.hasNextPage, isFetchingNextPage: search.isFetchingNextPage,
    fetchNextPage: search.fetchNextPage, data: search.data });

  useEffect(() => {
    if (routeQuery === appliedRouteQuery.current) return;
    appliedRouteQuery.current = routeQuery;
    setQuery((current) => routeQuery && current.startsWith(routeQuery) ? current : routeQuery);
  }, [routeQuery]);
  useEffect(() => {
    if (urlQuery === appliedRouteQuery.current) return;
    appliedRouteQuery.current = urlQuery;
    router.setParams({ query: urlQuery });
  }, [urlQuery, router]);
  return { query, setQuery, trimmed, filters, setFilters, listFilters, active, filtersOn, items, search, searching, searchError, ...paging };
}
