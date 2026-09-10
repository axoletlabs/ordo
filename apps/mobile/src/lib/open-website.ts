/**
 * Open a live URL in the user's chosen browser.
 *
 * - Ordo: caller shows BookmarkBrowser (not handled here).
 * - In-app: Safari View Controller / Chrome Custom Tabs overlay.
 * - External: the Safari or Chrome app.
 */
import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { BookmarkDto } from "@ordo/shared";
import { toast } from "../components/ui/toast-store";
import { queryClient } from "./query-client";
import { bookmarksApi } from "./api/bookmarks";
import { qk } from "./api/query-keys";
import { bumpFolderCount, updateBookmarkEverywhere } from "./cache-helpers";
import { bookmarkOpensAsWebsite } from "./bookmark-reader";
import { useSettingsStore, type WebsiteBrowser } from "../store/settings";

export type SystemBrowser = Exclude<WebsiteBrowser, "ordo">;

function websiteBrowser(): WebsiteBrowser {
  return useSettingsStore.getState().websiteBrowser;
}

export async function openExternalBrowser(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    toast.error("Couldn't open this page in the browser.");
  }
}

export async function openInAppBrowser(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
      enableBarCollapsing: true,
      showTitle: true,
      enableDefaultShareMenuItem: true,
      createTask: false,
    });
  } catch {
    await openExternalBrowser(url);
  }
}

export async function openLivePage(url: string, browser: SystemBrowser): Promise<void> {
  if (browser === "inApp") await openInAppBrowser(url);
  else await openExternalBrowser(url);
}

function markOpened(bookmark: BookmarkDto): void {
  if (bookmark.isRead) return;
  updateBookmarkEverywhere(queryClient, bookmark.id, (current) => ({ ...current, isRead: true }));
  bumpFolderCount(queryClient, bookmark.folderId, 0, -1);
  void bookmarksApi
    .update(bookmark.id, { isRead: true }, { folderId: bookmark.folderId })
    .then((updated) => {
      updateBookmarkEverywhere(queryClient, updated.id, (current) => ({ ...current, ...updated }));
      void queryClient.invalidateQueries({ queryKey: qk.folders });
    })
    .catch(() => {
      updateBookmarkEverywhere(queryClient, bookmark.id, (current) => ({
        ...current,
        isRead: bookmark.isRead,
      }));
      bumpFolderCount(queryClient, bookmark.folderId, 0, 1);
    });
}

/** Open the live page in the device browser app, even if websites usually stay in ordo. */
export function openBookmarkInExternalBrowser(bookmark: BookmarkDto): void {
  markOpened(bookmark);
  void openExternalBrowser(bookmark.url);
}

/**
 * Open a library bookmark. Returns after handing off to a system browser, or
 * calls `openReader` when the page should stay in ordo.
 */
export function openListBookmark(bookmark: BookmarkDto, openReader: () => void): void {
  const browser = websiteBrowser();
  if (bookmarkOpensAsWebsite(bookmark) && browser !== "ordo") {
    markOpened(bookmark);
    void openLivePage(bookmark.url, browser);
    return;
  }
  openReader();
}
