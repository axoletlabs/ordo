/**
 * Live count of bookmarks whose article text is still being fetched.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { extractionPollIntervalMs } from "@ordo/shared";
import { bookmarksApi } from "../lib/api/bookmarks";
import { qk } from "../lib/api/query-keys";

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
    if (previous !== null && pending < previous) {
      void qc.invalidateQueries({
        predicate: (entry) =>
          entry.queryKey[0] === "bookmarks" && entry.queryKey[1] !== "extraction-progress",
      });
    }
  }, [qc, query.data?.pending]);

  return query;
}
