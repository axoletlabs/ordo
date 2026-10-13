/**
 * Live count of bookmarks whose article text is still being fetched.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { extractionPollIntervalMs } from "@ordo/shared";
import { bookmarksApi } from "../lib/api/bookmarks";
import { qk } from "../lib/api/query-keys";
import { shouldRefreshExtractionQuery } from "../lib/extraction-sync";

export function useExtractionProgress() {
  const qc = useQueryClient();
  const prevPending = useRef<number | null>(null);
  const query = useQuery({
    queryKey: qk.extractionProgress,
    queryFn: bookmarksApi.extractionProgress,
    refetchInterval: (q) =>
      (q.state.data?.pending ?? 0) > 0 ? extractionPollIntervalMs(q.state.dataUpdateCount) : false,
  });

  useEffect(() => {
    const pending = query.data?.pending;
    if (pending === undefined) return;
    const previous = prevPending.current;
    prevPending.current = pending;
    // A completion can be hidden by another save (same count), or happen
    // before the first progress response. Reconcile on every successful poll.
    void qc.invalidateQueries({
      predicate: (entry) => shouldRefreshExtractionQuery(
        entry.queryKey, entry.state.data, previous, pending,
      ),
    });
  }, [qc, query.data?.pending, query.dataUpdatedAt]);

  return query;
}
