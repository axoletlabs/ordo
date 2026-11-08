/** Durable delete intents, containing IDs only (never locked bookmark content).
 * Write synchronously before hiding rows so process death cannot lose a delete.
 * Each server/account owns a separate journal; credentials are never captured. */
import { Platform } from "react-native";
import { createMMKV, type MMKV } from "react-native-mmkv";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";
import { queryCacheStorageKey } from "./query-persist";

export interface DeleteIntent {
  id: string;
  bookmarks: { id: string; folderId: string | null }[];
  folders: string[];
  tags: string[];
  contained: string[];
  /** Bookmarks moved to the unfiled root before their folder cascades away.
   * Optional so journals written before keep-on-delete still replay. */
  keeps?: { id: string; folderId: string }[];
}

let storage: MMKV | undefined;
let sequence = 0;

export function deleteJournalKey(): string | null {
  const auth = useAuthStore.getState();
  if (auth.status !== "authenticated" || !auth.user) return null;
  return `${queryCacheStorageKey(auth.user.id, useSettingsStore.getState().serverUrl)}.deletes.v1`;
}

function read(key: string): string | undefined | null {
  if (Platform.OS === "web") return window.localStorage.getItem(key);
  storage ??= createMMKV({ id: "ordo-delete-journal" });
  return storage.getString(key);
}

function write(key: string, entries: DeleteIntent[]) {
  const value = JSON.stringify(entries);
  if (Platform.OS === "web") window.localStorage.setItem(key, value);
  else {
    storage ??= createMMKV({ id: "ordo-delete-journal" });
    storage.set(key, value);
  }
}

function isDeleteIntent(entry: unknown): entry is DeleteIntent {
  if (!entry || typeof entry !== "object") return false;
  const intent = entry as Partial<DeleteIntent>;
  const keepsValid = (keeps: DeleteIntent["keeps"]) =>
    keeps === undefined ||
    (Array.isArray(keeps) && keeps.every((keep) => typeof keep?.id === "string" && typeof keep?.folderId === "string"));
  return (
    typeof intent.id === "string" &&
    Array.isArray(intent.bookmarks) &&
    intent.bookmarks.every((item) => typeof item?.id === "string" && (item.folderId === null || typeof item.folderId === "string")) &&
    [intent.folders, intent.tags, intent.contained].every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string")) &&
    keepsValid(intent.keeps)
  );
}

/** Read the journal defensively. Corrupt storage must never brick deletion
 * forever: salvage every entry that still validates, rewrite the repaired
 * list, and drop the rest. Untrusted bytes are the only thing discarded —
 * a valid intent's tombstones still replay. */
export function readDeleteIntents(key: string): DeleteIntent[] {
  const raw = read(key);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    resetDeleteIntents(key);
    return [];
  }
  if (!Array.isArray(parsed)) {
    resetDeleteIntents(key);
    return [];
  }
  const entries = parsed.filter(isDeleteIntent);
  if (entries.length !== parsed.length) resetDeleteIntents(key, entries);
  return entries;
}

function resetDeleteIntents(key: string, entries: DeleteIntent[] = []) {
  try {
    write(key, entries);
  } catch {
    /* best effort: a full/quarantined journal must still let the caller run */
  }
}

export function recordDeleteIntent(input: Omit<DeleteIntent, "id">) {
  const key = deleteJournalKey();
  if (!key) throw new Error("Sign in before deleting saved items.");
  const intent = { ...input, id: `${Date.now()}-${++sequence}` };
  write(key, [...readDeleteIntents(key), intent]);
  return { key, intent };
}

export function forgetDeleteIntent(key: string, id: string) {
  write(key, readDeleteIntents(key).filter((entry) => entry.id !== id));
}
