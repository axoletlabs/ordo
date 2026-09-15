/**
 * Persist folders + public bookmark lists to MMKV across process death.
 * Restore during splash so the library paints from disk, then refetch.
 */
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { createMMKV, type MMKV } from "react-native-mmkv";
import { queryClient } from "./query-client";
import { qk } from "./api/query-keys";
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
