/**
 * Persist folders + public bookmark lists to MMKV across process death.
 * The snapshot is restored during splash with no network dependency, so the
 * last library paints immediately and a slow or down host can never hold the
 * launch. Refreshes settle after the UI is up; the offline gate covers a
 * confirmed-down host once the probe answers.
 */
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { DEFAULT_BOOKMARK_LIST_SORT } from "@ordo/shared";
import { createMMKV, type MMKV } from "react-native-mmkv";
import { bookmarksApi } from "./api/bookmarks";
import { fetchFoldersNormalized } from "./api/folders";
import { nextPageCursor, qk } from "./api/query-keys";
import { serverApi } from "./api/server";
import { LIST_PAGE_SIZE } from "./list-pagination";
import { queryClient } from "./query-client";
import {
  PERSISTED_QUERY_GC_TIME_MS,
  PERSISTED_QUERY_MAX_AGE_MS,
  QUERY_CACHE_BUSTER,
  protectedFolderIdsFromFolders,
  queryCacheStorageKey,
  sanitizePersistedClient,
  shouldPersistQueryKey,
  type PersistedClientSnapshot,
} from "./query-persist";
import { raceDeadline } from "./fetch-timeout";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";

function sanitizeForDisk(client: PersistedClient): PersistedClient {
  return sanitizePersistedClient(client as unknown as PersistedClientSnapshot) as unknown as PersistedClient;
}

let mmkv: MMKV | null | undefined;
let activeStorageKey: string | null = null;
let unsubscribe: (() => void) | undefined;
let restoreGeneration = 0;

function getMmkv(): MMKV | null {
  if (mmkv !== undefined) return mmkv;
  try {
    mmkv = createMMKV({ id: "ordo-query-cache" });
  } catch (error) {
    console.warn("Query cache storage unavailable", error);
    mmkv = null;
  }
  return mmkv;
}

function protectedFolderIdsFromCache() {
  return protectedFolderIdsFromFolders(queryClient.getQueryData(qk.folders));
}

function createQueryCachePersister(storageKey: string): Persister {
  const storage = getMmkv();
  return createSyncStoragePersister({
    storage: storage
      ? {
          getItem: (key) => storage.getString(key) ?? null,
          setItem: (key, value) => {
            storage.set(key, value);
          },
          removeItem: (key) => {
            storage.remove(key);
          },
        }
      : undefined,
    key: storageKey,
    throttleTime: 1000,
    serialize: (client) => JSON.stringify(sanitizeForDisk(client)),
    deserialize: (cachedString) => sanitizeForDisk(JSON.parse(cachedString) as PersistedClient),
  });
}

function persistOptions(persister: Persister) {
  return {
    queryClient,
    persister,
    maxAge: PERSISTED_QUERY_MAX_AGE_MS,
    buster: QUERY_CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) =>
        query.state.status === "success" &&
        shouldPersistQueryKey(query.queryKey, protectedFolderIdsFromCache()),
    },
    hydrateOptions: {
      defaultOptions: {
        queries: {
          gcTime: PERSISTED_QUERY_GC_TIME_MS,
        },
      },
    },
  };
}

export function stopQueryPersistence() {
  restoreGeneration += 1;
  unsubscribe?.();
  unsubscribe = undefined;
  activeStorageKey = null;
}

/** Drop the in-memory cache and every on-disk list snapshot (logout / server switch). */
export function discardQueryCache() {
  stopQueryPersistence();
  queryClient.clear();
  try {
    getMmkv()?.clearAll();
  } catch {
    /* ignore — best effort */
  }
}

/** Restore the last snapshot for this account, then keep writing it. */
export async function restoreQueryPersistence(userId: string, serverUrl: string): Promise<void> {
  const storageKey = queryCacheStorageKey(userId, serverUrl);
  if (activeStorageKey === storageKey && unsubscribe) return;

  unsubscribe?.();
  unsubscribe = undefined;
  activeStorageKey = storageKey;
  const generation = ++restoreGeneration;
  const options = persistOptions(createQueryCachePersister(storageKey));

  try {
    await persistQueryClientRestore(options);
  } catch (error) {
    console.warn("Query cache restore failed", error);
  }

  if (generation !== restoreGeneration || activeStorageKey !== storageKey) return;
  unsubscribe = persistQueryClientSubscribe(options);
}

function homeLibraryCached(): boolean {
  return (
    queryClient.getQueryData(qk.folders) != null &&
    queryClient.getQueryData(qk.bookmarks(null, DEFAULT_BOOKMARK_LIST_SORT)) != null
  );
}

async function fetchHomeLibrary(): Promise<void> {
  await Promise.all([
    queryClient.fetchQuery({
      queryKey: qk.folders,
      queryFn: fetchFoldersNormalized,
      staleTime: 30_000,
      gcTime: PERSISTED_QUERY_GC_TIME_MS,
      // Launch fetches never retry: the splash deadline (below) is the only
      // budget they get, and mounted observers retry with their own policy.
      retry: false,
    }),
    queryClient.fetchInfiniteQuery({
      queryKey: qk.bookmarks(null, DEFAULT_BOOKMARK_LIST_SORT),
      queryFn: ({ pageParam }) =>
        bookmarksApi.list({
          folderId: null,
          cursor: pageParam ?? undefined,
          limit: LIST_PAGE_SIZE,
          sort: DEFAULT_BOOKMARK_LIST_SORT,
        }),
      initialPageParam: null as string | null,
      getNextPageParam: nextPageCursor,
      staleTime: 30_000,
      gcTime: PERSISTED_QUERY_GC_TIME_MS,
      retry: false,
    }),
  ]);
}

/** Warm the MFA/offline signals without ever gating the launch on them. */
async function prefetchServerInfo(serverUrl: string): Promise<void> {
  try {
    await queryClient.fetchQuery({
      queryKey: qk.serverInfo(serverUrl),
      queryFn: () => serverApi.info(),
      staleTime: 60_000,
      retry: false,
    });
  } catch {
    /* the mounted probe + offline gate own the retry story */
  }
}

/**
 * How long a cold-cache launch may hold the splash on the network. Past the
 * deadline the app continues (skeletons cover the gap) while the fetches keep
 * running and paint the library the moment they land.
 */
const LAUNCH_FETCH_DEADLINE_MS = 3_500;

/**
 * Restore the disk snapshot, then fill a cold cache before the home screen
 * mounts. The snapshot restore is local-only and always runs first; a dead or
 * slow host can add at most LAUNCH_FETCH_DEADLINE_MS to the launch, never the
 * per-request timeout stack.
 */
export async function prepareLaunchLibrary(): Promise<void> {
  const auth = useAuthStore.getState();
  if (auth.status !== "authenticated" || !auth.user) {
    stopQueryPersistence();
    return;
  }
  const serverUrl = useSettingsStore.getState().serverUrl;

  await restoreQueryPersistence(auth.user.id, serverUrl);

  if (homeLibraryCached()) {
    void prefetchServerInfo(serverUrl);
    return;
  }

  const fill = Promise.allSettled([prefetchServerInfo(serverUrl), fetchHomeLibrary()]).then(
    (results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn("Launch library fetch failed", result.reason);
        }
      }
    },
  );
  await raceDeadline(fill, LAUNCH_FETCH_DEADLINE_MS);
}
