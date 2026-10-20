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

export function readDeleteIntents(key: string): DeleteIntent[] {
  const raw = read(key);
  if (!raw) return [];
  const entries = JSON.parse(raw) as DeleteIntent[];
  const keepsValid = (keeps: DeleteIntent["keeps"]) =>
    keeps === undefined ||
    (Array.isArray(keeps) && keeps.every((keep) => typeof keep?.id === "string" && typeof keep?.folderId === "string"));
  if (!Array.isArray(entries) || entries.some((entry) =>
    typeof entry.id !== "string" || !Array.isArray(entry.bookmarks) ||
    entry.bookmarks.some((item) => typeof item.id !== "string" || !(item.folderId === null || typeof item.folderId === "string")) ||
    [entry.folders, entry.tags, entry.contained].some((ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== "string")) ||
    !keepsValid(entry.keeps))) {
    throw new Error("Couldn't read pending deletions.");
  }
  return entries;
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
