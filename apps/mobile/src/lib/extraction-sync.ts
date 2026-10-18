/** Reconcile pending rows even when the server count stays flat or skips to zero. */
export function shouldRefreshExtractionQuery(
  queryKey: readonly unknown[],
  data: unknown,
  previousPending: number | null,
  pending: number,
): boolean {
  if (queryKey[0] !== "bookmarks" || queryKey[1] === "extraction-progress" || queryKey[1] === "library-index") return false;
  if (previousPending !== null && pending < previousPending) return true;
  // While the count holds steady (a completion masked by another save), only
  // refresh views that actually show a pending row. The progressively-loaded
  // search index is excluded so polls cannot refetch every page; search
  // results recompile from the refreshed list/detail copies instead.
  return hasPendingExtraction(data);
}

function hasPendingExtraction(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as { fetchStatus?: unknown; pages?: unknown; items?: unknown };
  if (record.fetchStatus === "pending") return true;
  if (Array.isArray(record.pages)) return record.pages.some(hasPendingExtraction);
  if (Array.isArray(record.items)) return record.items.some(hasPendingExtraction);
  return false;
}
