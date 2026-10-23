/**
 * Persist folders + public bookmark lists to MMKV across process death.
 * The snapshot is restored during splash with no network dependency, so the
 * last library paints immediately and a slow or down host can never hold the
 * launch. Refreshes settle after the UI is up; the offline gate covers a
 * confirmed-down host once the probe answers.
 *
 * Snapshot volume is bounded in query-persist.ts (folders + default unfiled
 * list + a recency-bounded set of other lists). RAM queries are never trimmed;
 * budgeting only limits what reaches disk, so saves stay small synchronous
 * writes regardless of how many folders were visited this session.
 */
import { AppState, Platform } from "react-native";
import {
  persistQueryClientSave,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { hydrate, type QueryCacheNotifyEvent } from "@tanstack/react-query";
import { captureSessionScope, isSessionScopeCurrent } from "./session-scope";
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
  isFoldersListKey,
  isPersistedBookmarkListKey,
  protectedFolderIdsFromFolders,
  queryCacheStorageKey,
  shouldPersistQueryKey,
  createSnapshotPersister,
} from "./query-persist";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";
import { useFolderTokenStore } from "../store/folder-tokens";
import { resumePendingDeletes } from "./undoable-delete";

let mmkv: MMKV | null | undefined;
let activeStorageKey: string | null = null;
let unsubscribe: (() => void) | undefined;
let restoreGeneration = 0;

/** Runs synchronously with the stores, before a new account can observe shared
 * query keys. Keep the outgoing painted library only until the next sign-in. */
export function installSessionCacheIsolation(): () => void {
  let owner: string | null = null;
  let lastState = "";
  const update = () => {
    const auth = useAuthStore.getState();
    if (auth.status === "loading") return;
    const next = auth.user && auth.status === "authenticated"
      ? queryCacheStorageKey(auth.user.id, useSettingsStore.getState().serverUrl) : null;
    const state = `${auth.status}:${next ?? ""}`;
    if (state === lastState) return;
    lastState = state;
    if (!next) {
      stopQueryPersistence();
      resumePendingDeletes(); // drop account-scoped tombstones and Undo surfaces
      void useFolderTokenStore.getState().clearAll();
      return;
    }
    if (owner && owner !== next) {
      discardQueryCache();
      void useFolderTokenStore.getState().clearAll();
      resumePendingDeletes();
    }
    owner = next;
  };
  const releaseAuth = useAuthStore.subscribe(update);
  const releaseSettings = useSettingsStore.subscribe(update);
  update();
  return () => { releaseAuth(); releaseSettings(); };
}

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
  return createSnapshotPersister(getMmkv(), storageKey);
}

/** Built per save so the folder lock lookup runs once, not once per query. */
function dehydrateOptions() {
  const protectedIds = protectedFolderIdsFromCache();
  return {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) =>
      query.state.status === "success" && shouldPersistQueryKey(query.queryKey, protectedIds),
  };
}

function persistOptions(persister: Persister) {
  return {
    queryClient,
    persister,
    maxAge: PERSISTED_QUERY_MAX_AGE_MS,
    buster: QUERY_CACHE_BUSTER,
    dehydrateOptions: dehydrateOptions(),
    hydrateOptions: {
      defaultOptions: {
        queries: {
          gcTime: PERSISTED_QUERY_GC_TIME_MS,
        },
      },
    },
  };
}

/** Trailing window that turns a burst of list updates into one disk write. */
const PERSIST_DELAY_MS = 1_000;

/** Only folders and public bookmark lists reach disk; other queries never trigger a write. */
function changesPersistedSnapshot(event: QueryCacheNotifyEvent): boolean {
  const key = event.query.queryKey;
  if (!isFoldersListKey(key) && !isPersistedBookmarkListKey(key)) return false;
  if (event.type === "removed") return true;
  return event.type === "updated" && event.action.type === "success";
}

/**
 * TanStack's subscriber dehydrates the whole cache on every cache event
 * (fetch start, polling, search keystrokes, reader loads) and serializes the
 * snapshot each second while anything is active. Save only when persisted
 * data changes, once per burst, and right away when the app leaves the
 * foreground.
 */
function subscribePersistence(options: ReturnType<typeof persistOptions>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    void persistQueryClientSave({ ...options, dehydrateOptions: dehydrateOptions() }).catch((error) =>
      console.warn("Query cache save failed", error));
  };
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (timer || !changesPersistedSnapshot(event)) return;
    timer = setTimeout(save, PERSIST_DELAY_MS);
  });
  const appState = AppState.addEventListener("change", (state) => {
    if (state !== "active" && timer) save();
  });
  const flush = () => { if (timer) save(); };
  if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("pagehide", flush);
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribeCache();
    appState.remove();
    if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("pagehide", flush);
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
    const snapshot = await options.persister.restoreClient();
    // Check after the storage await and before synchronous hydration. Checking
    // only after persistQueryClientRestore is too late: it already hydrated.
    if (generation !== restoreGeneration || activeStorageKey !== storageKey) return;
    if (snapshot) {
      if (!snapshot.timestamp || Date.now() - snapshot.timestamp > options.maxAge || snapshot.buster !== options.buster) {
        await options.persister.removeClient();
      } else {
        hydrate(queryClient, snapshot.clientState, options.hydrateOptions);
      }
    }
  } catch (error) {
    console.warn("Query cache restore failed", error);
  }

  if (generation !== restoreGeneration || activeStorageKey !== storageKey) return;
  unsubscribe = subscribePersistence(options);
  resumePendingDeletes();
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
      // Launch prefetches never retry; mounted observers own retry feedback.
      retry: false,
    }),
    queryClient.fetchInfiniteQuery({
      queryKey: qk.bookmarks(null, DEFAULT_BOOKMARK_LIST_SORT),
      queryFn: ({ pageParam, signal }) =>
        bookmarksApi.list({
          folderId: null,
          cursor: pageParam ?? undefined,
          limit: LIST_PAGE_SIZE,
          sort: DEFAULT_BOOKMARK_LIST_SORT,
          signal,
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
 * Only local restoration gates first paint. Fill a cold cache in parallel
 * with navigation; the library's skeleton already handles this state. Waiting
 * for the network here used to add up to 3.5 seconds of non-interactive splash
 * even when the fonts, session, and route were ready.
 */
export async function prepareLaunchLibrary(): Promise<void> {
  const owner = captureSessionScope();
  const auth = useAuthStore.getState();
  if (auth.status !== "authenticated" || !auth.user) {
    stopQueryPersistence();
    return;
  }
  const serverUrl = useSettingsStore.getState().serverUrl;

  await restoreQueryPersistence(auth.user.id, serverUrl);
  if (!isSessionScopeCurrent(owner)) return;

  void prefetchServerInfo(serverUrl);
  if (!homeLibraryCached()) void fetchHomeLibrary().catch((error) => {
    console.warn("Launch library fetch failed", error);
  });
}
