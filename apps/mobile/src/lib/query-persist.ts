/**
 * What belongs on disk for a cold start, and what must never leave RAM.
 *
 * Persist folders + the first pages of unfiled / unprotected bookmark lists so
 * the library paints before the network. Skip reader HTML, search, tagged
 * lists (they can include locked-folder rows), and protected-folder lists.
 * The snapshot is budgeted (see MAX_PERSISTED_RECENT_LISTS) so a save stays a
 * small synchronous write instead of growing with every folder visited.
 */
import { DEFAULT_BOOKMARK_LIST_SORT, isBookmarkListSort, type FolderDto } from "@ordo/shared";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

type SnapshotStorage = { getString: (key: string) => string | undefined; set: (key: string, value: string) => void; remove: (key: string) => unknown };

/** The subscriber owns throttling. A second zero-delay timer here can lose
 * the final write during pagehide/native suspension, so persistence is sync. */
export function createSnapshotPersister(storage: SnapshotStorage | null, key: string): Persister {
  const sanitize = (client: PersistedClient) => sanitizePersistedClient(client as unknown as PersistedClientSnapshot) as unknown as PersistedClient;
  return {
    persistClient: (client) => { storage?.set(key, JSON.stringify(sanitize(client))); },
    restoreClient: () => {
      const raw = storage?.getString(key);
      if (!raw) return undefined;
      const client = sanitize(JSON.parse(raw) as PersistedClient);
      // Disk is a first-paint/offline fallback, never proof of server freshness.
      // A previous process/tab may have exited before its last mutation saved.
      return { ...client, clientState: { ...client.clientState, queries: client.clientState.queries.map((query) => ({
        ...query, state: { ...query.state, isInvalidated: true },
      })) } };
    },
    removeClient: () => { storage?.remove(key); },
  };
}

/** Keep restored lists around for the persist maxAge window. */
export const PERSISTED_QUERY_GC_TIME_MS = 7 * 24 * 60 * 60_000;
export const PERSISTED_QUERY_MAX_AGE_MS = PERSISTED_QUERY_GC_TIME_MS;
export const QUERY_CACHE_BUSTER = "ordo-query-v2";
export const MAX_PERSISTED_LIST_PAGES = 3;
export const QUERY_CACHE_STORAGE_PREFIX = "ordo.rq.";

/**
 * Snapshot budget. Every save serializes the whole snapshot synchronously on
 * the JS thread (JSON + MMKV write), so an unbounded set of visited folder /
 * sort lists made ordinary actions freeze ~1s later — measured 32.6 ms and
 * 7.9 MB per save after visiting 60 folders (4-core ARM). Bounded by list
 * query count and total rows instead of estimating serialized bytes on every
 * save. The RAM query cache is never trimmed; only the disk snapshot is.
 *
 * Cold-start tradeoff: only the folders catalogue, the default-sort unfiled
 * list (sort preferences are session-only, so that is the list the library
 * boots with), and the newest `MAX_PERSISTED_RECENT_LISTS` other lists reach
 * disk. Folders older than that paint their skeleton on a cold start and
 * refetch exactly like folders never opened this session — no data is lost,
 * lists are still in RAM until then, and cross-device refresh is unchanged.
 */
export const MAX_PERSISTED_RECENT_LISTS = 6;
export const MAX_PERSISTED_LIST_ROWS = 1_800;

const RESERVED_BOOKMARK_SEGMENTS = new Set([
  "detail",
  "search",
  "library-index",
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
  const foldersQuery = queries.find((query) => isFoldersListKey(query?.queryKey ?? []));
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

/** `["bookmarks", null, DEFAULT_BOOKMARK_LIST_SORT]` — the list the library cold-boots into (sort prefs are session-only). */
export function isDefaultUnfiledListKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey.length === 3 &&
    queryKey[0] === "bookmarks" &&
    queryKey[1] === null &&
    queryKey[2] === DEFAULT_BOOKMARK_LIST_SORT
  );
}

function queryUpdatedAt(query: PersistedQuerySnapshot): number {
  const at = query.state?.dataUpdatedAt;
  return typeof at === "number" && Number.isFinite(at) ? at : 0;
}

/** Rows a trimmed list query adds to the snapshot: first pages only, ≤ MAX_PERSISTED_LIST_PAGES. */
function persistedListRowCount(queryKey: readonly unknown[], data: unknown): number {
  if (!isPersistedBookmarkListKey(queryKey)) return 0;
  const pages = (data as { pages?: unknown } | null | undefined)?.pages;
  if (!Array.isArray(pages)) return 0;
  let rows = 0;
  for (const page of pages.slice(0, MAX_PERSISTED_LIST_PAGES)) {
    const items = (page as { items?: unknown } | null | undefined)?.items;
    if (Array.isArray(items)) rows += items.length;
  }
  return rows;
}

/** Newest first; ties resolved by key order so repeated saves pick the same set. */
function byRecencyThenKey(
  a: { query: PersistedQuerySnapshot; rank: string },
  b: { query: PersistedQuerySnapshot; rank: string },
): number {
  return queryUpdatedAt(b.query) - queryUpdatedAt(a.query) || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
}

/**
 * Privacy first, budget second: protected-folder filtering runs before the
 * recency pool so a protected list can never spend budget or slip in. The
 * folders catalogue (needed to know what is protected on the next pass) and
 * the default unfiled list are essential and never dropped; every other
 * persisted list (folder lists and non-default unfiled sorts) competes for
 * the newest `MAX_PERSISTED_RECENT_LISTS` slots under `MAX_PERSISTED_LIST_ROWS`.
 * Input is never mutated; malformed queries are treated as oldest/empty.
 */
export function sanitizePersistedClient<T extends PersistedClientSnapshot>(client: T): T {
  const queries = Array.isArray(client.clientState?.queries) ? client.clientState.queries : [];
  const protectedIds = protectedFolderIdsFromQueries(queries);
  const essential: PersistedQuerySnapshot[] = [];
  const pool: { query: PersistedQuerySnapshot; rank: string; rows: number }[] = [];
  let rows = 0;
  for (const query of queries) {
    if (!query || typeof query !== "object" || !Array.isArray(query.queryKey)) continue;
    if (!shouldPersistQueryKey(query.queryKey, protectedIds)) continue;
    if (isFoldersListKey(query.queryKey)) {
      // Folder metadata is what first paint and the next privacy pass read; never budgeted away.
      essential.push(query);
      continue;
    }
    const data = trimPersistedQueryData(query.queryKey, query.state?.data);
    const trimmed: PersistedQuerySnapshot =
      data === query.state?.data ? query : { ...query, state: { ...query.state, data } };
    const count = persistedListRowCount(query.queryKey, data);
    if (isDefaultUnfiledListKey(query.queryKey)) {
      essential.push(trimmed);
      rows += count;
      continue;
    }
    pool.push({ query: trimmed, rank: JSON.stringify(query.queryKey), rows: count });
  }
  pool.sort(byRecencyThenKey);
  const kept = [...essential];
  let recentLists = 0;
  for (const entry of pool) {
    if (recentLists >= MAX_PERSISTED_RECENT_LISTS || rows + entry.rows > MAX_PERSISTED_LIST_ROWS) break;
    kept.push(entry.query);
    rows += entry.rows;
    recentLists += 1;
  }
  return {
    ...client,
    clientState: {
      ...client.clientState,
      mutations: [],
      queries: kept,
    },
  };
}
