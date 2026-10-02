/** Immediate cached matches, followed by paginated server/article-body matches. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { BookmarkDto } from "@ordo/shared";
import { useInfiniteSearch } from "./use-bookmarks";
import { useLoadMore } from "./use-list-controls";
import { collectCachedBookmarks } from "../lib/cache-helpers";
import { flattenPages } from "../lib/api/query-keys";
import { compileSearchResults, EMPTY_SEARCH_FILTERS, reuseSearchResults, sanitizeRouteParam,
  searchFiltersActive, searchFiltersEqual, searchScopeActive, useDebouncedValue, useDeferredLayoutValue,
  type SearchFilters } from "../lib/search-bookmarks";

const EMPTY: BookmarkDto[] = [];
export function useLibrarySearch(localItems: readonly BookmarkDto[]) {
  const router = useRouter();
  const params = useLocalSearchParams<{ query?: string }>();
  const routeQuery = sanitizeRouteParam(params.query);
  const appliedRouteQuery = useRef(routeQuery);
  const [query, setQuery] = useState(routeQuery);
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const listFilters = useDeferredLayoutValue(filters, searchFiltersEqual);
  const trimmed = query.trim();
  const active = trimmed.length > 0 || searchScopeActive(listFilters);
  const filtersOn = searchFiltersActive(filters);
  const serverQuery = useDebouncedValue(trimmed, 250);
  const urlQuery = useDebouncedValue(trimmed, 1000);
  const queryClient = useQueryClient();
  const search = useInfiniteSearch(serverQuery, { tagIds: listFilters.tagIds, folderIds: listFilters.folderIds,
    unfiled: listFilters.unfiled, unread: listFilters.status, fuzzy: listFilters.fuzzy,
    reminder: listFilters.reminder, enabled: !!serverQuery || searchScopeActive(listFilters) });
  const serverItems = useMemo(() => flattenPages(search.data?.pages ?? []), [search.data]);
  const cachedItems = useMemo(() => active ? [...localItems, ...collectCachedBookmarks(queryClient)] : EMPTY,
    [active, localItems, queryClient, search.dataUpdatedAt]);
  const compiled = useMemo(() => active ? compileSearchResults({ query: trimmed, filters: listFilters, serverItems,
    cachedItems, serverMatchesQuery: trimmed === serverQuery }) : EMPTY, [active, trimmed, listFilters, serverItems, cachedItems, serverQuery]);
  const previous = useRef(EMPTY);
  const items = reuseSearchResults(previous.current, compiled);
  previous.current = items;
  const paging = useLoadMore({ hasNextPage: !!search.hasNextPage, isFetchingNextPage: search.isFetchingNextPage,
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
  return { query, setQuery, trimmed, filters, setFilters, listFilters, active, filtersOn, items, search, ...paging };
}
