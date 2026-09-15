/**
 * What belongs on disk for a cold start, and what must never leave RAM.
 *
 * Persist folders + the first pages of unfiled / unprotected bookmark lists so
 * an online cold start can paint before the refetch. This is not an offline
 * mode — hydration is skipped when the device has no network. Skip reader HTML,
 * search, tagged lists (they can include locked-folder rows), and protected-
 * folder lists.
 */
import { isBookmarkListSort, type FolderDto } from "@ordo/shared";

/** Keep restored lists around for the persist maxAge window. */
export const PERSISTED_QUERY_GC_TIME_MS = 7 * 24 * 60 * 60_000;
export const PERSISTED_QUERY_MAX_AGE_MS = PERSISTED_QUERY_GC_TIME_MS;
export const QUERY_CACHE_BUSTER = "ordo-query-v2";
export const MAX_PERSISTED_LIST_PAGES = 3;
export const QUERY_CACHE_STORAGE_PREFIX = "ordo.rq.";

const RESERVED_BOOKMARK_SEGMENTS = new Set([
  "detail",
  "search",
  "tagged",
  "extraction-progress",
]);

export type PersistedQuerySnapshot = {
  queryKey: readonly unknown[];
  state: { data?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};

export type PersistedClientSnapshot = {
  timestamp: number;
  buster: string;
  clientState: {
    mutations: unknown[];
    queries: PersistedQuerySnapshot[];
  };
};

export function queryCacheStorageKey(userId: string, serverUrl: string): string {
  return `${QUERY_CACHE_STORAGE_PREFIX}${userId}.${encodeURIComponent(cacheServerOrigin(serverUrl))}`;
}

function cacheServerOrigin(raw: string): string {
  const trimmed = raw.trim();
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).origin || trimmed.replace(/\/+$/, "").toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

export function isFoldersListKey(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 1 && queryKey[0] === "folders";
}

/** `["bookmarks", folderId | null, sort]` — not detail/search/tagged. */
export function isPersistedBookmarkListKey(queryKey: readonly unknown[]): boolean {
  if (queryKey.length !== 3 || queryKey[0] !== "bookmarks") return false;
  const folderId = queryKey[1];
  if (folderId !== null && typeof folderId !== "string") return false;
  if (typeof folderId === "string" && RESERVED_BOOKMARK_SEGMENTS.has(folderId)) return false;
  return isBookmarkListSort(queryKey[2]);
}

/**
 * `protectedFolderIds` undefined means the folder catalogue is missing: persist
 * unfiled only, never a named folder whose lock state we cannot check.
 */
export function shouldPersistQueryKey(
  queryKey: readonly unknown[],
  protectedFolderIds: ReadonlySet<string> | undefined,
): boolean {
  if (isFoldersListKey(queryKey)) return true;
  if (!isPersistedBookmarkListKey(queryKey)) return false;
  const folderId = queryKey[1];
  if (folderId == null) return true;
  if (typeof folderId !== "string") return false;
  if (!protectedFolderIds) return false;
  return !protectedFolderIds.has(folderId);
}

export function protectedFolderIdsFromFolders(folders: unknown): Set<string> | undefined {
  if (!Array.isArray(folders)) return undefined;
  const ids = new Set<string>();
  for (const folder of folders as FolderDto[]) {
    if (folder?.protected && typeof folder.id === "string") ids.add(folder.id);
  }
  return ids;
}

export function protectedFolderIdsFromQueries(
  queries: ReadonlyArray<{ queryKey: readonly unknown[]; state?: { data?: unknown } }>,
): Set<string> | undefined {
  const foldersQuery = queries.find((query) => isFoldersListKey(query.queryKey));
  return protectedFolderIdsFromFolders(foldersQuery?.state?.data);
}

export function trimPersistedQueryData(queryKey: readonly unknown[], data: unknown): unknown {
  if (!isPersistedBookmarkListKey(queryKey)) return data;
  if (!data || typeof data !== "object") return data;
  const pages = (data as { pages?: unknown }).pages;
  const pageParams = (data as { pageParams?: unknown }).pageParams;
  if (!Array.isArray(pages) || pages.length <= MAX_PERSISTED_LIST_PAGES) return data;
  return {
    ...(data as object),
    pages: pages.slice(0, MAX_PERSISTED_LIST_PAGES),
    pageParams: Array.isArray(pageParams) ? pageParams.slice(0, MAX_PERSISTED_LIST_PAGES) : pageParams,
  };
}

export function sanitizePersistedClient<T extends PersistedClientSnapshot>(client: T): T {
  const queries = Array.isArray(client.clientState?.queries) ? client.clientState.queries : [];
  const protectedIds = protectedFolderIdsFromQueries(queries);
  return {
    ...client,
    clientState: {
      ...client.clientState,
      mutations: [],
      queries: queries.flatMap((query) => {
        if (!shouldPersistQueryKey(query.queryKey, protectedIds)) return [];
        const data = trimPersistedQueryData(query.queryKey, query.state?.data);
        if (data === query.state?.data) return [query];
        return [{ ...query, state: { ...query.state, data } }];
      }),
    },
  };
}
