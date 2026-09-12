import { BackHandler, Platform, ToastAndroid } from "react-native";
import { bookmarksApi } from "./api/bookmarks";
import { qk } from "./api/query-keys";
import { prependBookmarkToPages } from "./cache-helpers";
import { queryClient } from "./query-client";

/**
 * Put the sender app back in front after an Android share-target save or cancel.
 *
 * Deferred one tick so a still-visible RN Modal does not consume the default
 * back handler (which would only close the sheet and leave Ordo on screen).
 */
export function returnToShareSender(message?: string): void {
  if (Platform.OS !== "android") return;
  if (message) ToastAndroid.show(message, ToastAndroid.SHORT);
  setTimeout(() => BackHandler.exitApp(), 0);
}

/** Save an unfiled bookmark and prepend it to the root list cache. */
export async function saveUnfiledBookmark(url: string): Promise<void> {
  const bookmark = await bookmarksApi.create(url, null);
  prependBookmarkToPages(queryClient, qk.bookmarks(null), bookmark);
  if (bookmark.tags.length > 0) {
    void queryClient.invalidateQueries({ queryKey: ["tags"] });
  }
}
