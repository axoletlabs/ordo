/**
 * Cache of short-lived folder unlock tokens, keyed by folderId.
 * Folder tokens are folder-scoped and expire after TOKEN_TTL.FOLDER_MS
 * (10 minutes); `get` returns null once expired so the caller can re-prompt.
 */
import { AppState } from "react-native";
import { create } from "zustand";
import { secureGet, secureSet, StorageKeys } from "../lib/storage";
import { createCoalescedPersistence } from "../lib/coalesced-persistence";

interface FolderTokenEntry {
  token: string;
  /** Epoch ms when the token expires. */
  expiresAt: number;
}

type FolderTokenMap = Record<string, FolderTokenEntry>;
// Unlock, expiry and logout share one ordered writer. A slow unlock must not
// restore a token after a later clear has already reached secure storage.
const saveTokens = createCoalescedPersistence<FolderTokenMap>(tokens =>
  secureSet(StorageKeys.FOLDER_TOKENS, tokens));

export interface FolderTokenState {
  tokens: FolderTokenMap;
  /** Bumped whenever token access changes (unlock/expiry) so global query
   *  keys that depend on folder visibility can refetch. */
  accessRevision: number;
  hydrate: () => Promise<void>;
  /** Returns a live token, or null if none/expired. */
  get: (folderId: string) => string | null;
  /** All currently live tokens (for global scope requests). */
  liveTokens: () => string[];
  set: (folderId: string, token: string, expiresInSec: number) => void;
  clear: (folderId: string) => void;
  clearAll: () => Promise<void>;
}

const now = () => Date.now();

function prune(map: FolderTokenMap): FolderTokenMap {
  const t = now();
  const next: FolderTokenMap = {};
  let changed = false;
  for (const [k, v] of Object.entries(map)) {
    if (v.expiresAt > t) next[k] = v;
    else changed = true;
  }
  return changed ? next : map;
}

let pruneScheduled = false;
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePrune() {
  if (pruneScheduled) return;
  pruneScheduled = true;
  queueMicrotask(() => {
    pruneScheduled = false;
    const current = useFolderTokenStore.getState().tokens;
    const next = prune(current);
    if (next === current) return;
    useFolderTokenStore.setState((s) => ({
      tokens: next,
      accessRevision: s.accessRevision + 1,
    }));
    armAll(next);
    void saveTokens(next);
  });
}

function disarmExpiry(folderId: string) {
  const timer = expiryTimers.get(folderId);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(folderId);
}

function armExpiry(folderId: string, expiresAt: number) {
  disarmExpiry(folderId);
  const delay = Math.max(0, expiresAt - now() + 25);
  expiryTimers.set(
    folderId,
    setTimeout(() => {
      expiryTimers.delete(folderId);
      schedulePrune();
    }, delay),
  );
}

function armAll(map: FolderTokenMap) {
  for (const id of [...expiryTimers.keys()]) {
    if (!map[id]) disarmExpiry(id);
  }
  for (const [id, entry] of Object.entries(map)) {
    armExpiry(id, entry.expiresAt);
  }
}

AppState.addEventListener("change", (state) => {
  if (state === "active") schedulePrune();
});

export const useFolderTokenStore = create<FolderTokenState>((set, get) => ({
  tokens: {},
  accessRevision: 0,

  hydrate: async () => {
    const saved = await secureGet<FolderTokenMap>(StorageKeys.FOLDER_TOKENS);
    const tokens = saved ? prune(saved) : {};
    armAll(tokens);
    set((s) => ({ tokens, accessRevision: s.accessRevision + 1 }));
  },

  get: (folderId) => {
    const entry = get().tokens[folderId];
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      schedulePrune();
      return null;
    }
    return entry.token;
  },

  liveTokens: () => {
    const t = now();
    const live: string[] = [];
    let expired = false;
    for (const entry of Object.values(get().tokens)) {
      if (entry.expiresAt > t) live.push(entry.token);
      else expired = true;
    }
    if (expired) schedulePrune();
    return live;
  },

  set: (folderId, token, expiresInSec) => {
    const expiresAt = now() + expiresInSec * 1000;
    const next = { ...get().tokens, [folderId]: { token, expiresAt } };
    armExpiry(folderId, expiresAt);
    set((s) => ({ tokens: next, accessRevision: s.accessRevision + 1 }));
    void saveTokens(next);
  },

  clear: (folderId) => {
    disarmExpiry(folderId);
    const next = { ...get().tokens };
    delete next[folderId];
    set((s) => ({ tokens: next, accessRevision: s.accessRevision + 1 }));
    void saveTokens(next);
  },

  clearAll: async () => {
    for (const id of [...expiryTimers.keys()]) disarmExpiry(id);
    set((s) => ({ tokens: {}, accessRevision: s.accessRevision + 1 }));
    await saveTokens({});
  },
}));
