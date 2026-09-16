import { BackHandler, Platform, ToastAndroid } from "react-native";
import { bookmarksApi } from "./api/bookmarks";
import { insertCreatedBookmark } from "./cache-helpers";
import { queryClient } from "./query-client";
import { moveAppToBackground } from "./share-targets";

/**
 * Put the sender app back in front after an Android share-target save or cancel.
 *
 * Prefer a real moveTaskToBack. Synthesizing a back press while the save overlay
 * is still mounted would only close the sheet and leave Ordo on screen.
 */
export function returnToShareSender(message?: string): void {
  if (Platform.OS !== "android") return;
  if (message) ToastAndroid.show(message, ToastAndroid.SHORT);
  if (moveAppToBackground()) return;
  setTimeout(() => BackHandler.exitApp(), 0);
}

/** Save an unfiled bookmark and prepend it to the root list cache. */
export async function saveUnfiledBookmark(url: string): Promise<void> {
  const bookmark = await bookmarksApi.create(url, null);
  insertCreatedBookmark(queryClient, bookmark);
  if (bookmark.tags.length > 0) {
    void queryClient.invalidateQueries({ queryKey: ["tags"] });
  }
}
