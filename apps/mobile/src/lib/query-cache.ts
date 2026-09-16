/**
 * Drop the in-memory React Query cache (logout / server switch). Also wipes
 * leftover list snapshots from an older on-disk persist.
 */
import { createMMKV, type MMKV } from "react-native-mmkv";
import { queryClient } from "./query-client";

let mmkv: MMKV | null | undefined;

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

/** Drop leftover on-disk list snapshots from an older persist experiment. */
export function wipeLeftoverQuerySnapshots() {
  try {
    getMmkv()?.clearAll();
  } catch {
    /* ignore — best effort */
  }
}

export function discardQueryCache() {
  queryClient.clear();
  wipeLeftoverQuerySnapshots();
}
