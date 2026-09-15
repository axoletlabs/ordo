/**
 * List refresh and pagination that cannot fight each other.
 *
 * The native refresh bar is only `true` after the user pulls. `isFetching`
 * from React Query also turns on during fetchNextPage, which is what made
 * PERSONAL flash a reload chip at the bottom and never settle.
 * A next page that adds no unique rows is treated as the end.
 */
import { useCallback, useRef, useState } from "react";
import { flattenPages } from "../lib/api/query-keys";
import { pageLoadMadeProgress, shouldFetchNextPage } from "../lib/list-pagination";

type PageChunk = { items: unknown[] };

export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.resolve(refetch()).finally(() => setRefreshing(false));
  }, [refetch]);
  return { refreshing, onRefresh };
}

export function useLoadMore(query: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<{ data?: { pages?: PageChunk[] } }>;
  data?: { pages?: PageChunk[] };
}) {
  const lockRef = useRef(false);
  const stalledRef = useRef(false);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, data } = query;
  const headId = (data?.pages?.[0]?.items?.[0] as { id?: string } | undefined)?.id ?? "";
  const headRef = useRef(headId);
  if (headRef.current !== headId) {
    headRef.current = headId;
    stalledRef.current = false;
  }

  const resetPaging = useCallback(() => {
    stalledRef.current = false;
    lockRef.current = false;
  }, []);

  const onEndReached = useCallback(() => {
    if (
      !shouldFetchNextPage({
        hasNextPage,
        isFetchingNextPage,
        locked: lockRef.current,
        stalled: stalledRef.current,
      })
    ) {
      return;
    }
    lockRef.current = true;
    const before = flattenPages(data?.pages ?? []);
    void fetchNextPage()
      .then((result) => {
        const after = flattenPages(result.data?.pages ?? data?.pages ?? []);
        if (!pageLoadMadeProgress(before.length, after.length)) {
          stalledRef.current = true;
        }
      })
      .catch(() => {
        stalledRef.current = true;
      })
      .finally(() => {
        lockRef.current = false;
      });
  }, [data, fetchNextPage, hasNextPage, isFetchingNextPage]);

  return { onEndReached, loadingMore: isFetchingNextPage, resetPaging };
}