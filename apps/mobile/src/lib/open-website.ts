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
import { bumpFolderCount, syncReminderInCache, updateBookmarkEverywhere } from "./cache-helpers";
import { bookmarkOpensAsWebsite } from "./bookmark-reader";
import { reminderClearsOnOpen } from "./bookmark-reminders";
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

export function ackBookmarkOpened(bookmark: BookmarkDto): void {
  const due = reminderClearsOnOpen(bookmark.remindAt);
  if (bookmark.isRead && !due) return;

  const patch: { isRead?: true; remindAt?: null } = {};
  if (!bookmark.isRead) patch.isRead = true;
  if (due) patch.remindAt = null;
  const previous = { isRead: bookmark.isRead, remindAt: bookmark.remindAt };

  updateBookmarkEverywhere(queryClient, bookmark.id, (current) => ({ ...current, ...patch }));
  if (!bookmark.isRead) bumpFolderCount(queryClient, bookmark.folderId, 0, -1);
  if (due) {
    syncReminderInCache(queryClient, {
      id: bookmark.id,
      folderId: bookmark.folderId,
      title: bookmark.title,
      remindAt: null,
    });
  }

  void bookmarksApi
    .update(bookmark.id, patch, { folderId: bookmark.folderId })
    .then((updated) => {
      updateBookmarkEverywhere(queryClient, updated.id, (current) => ({ ...current, ...updated }));
      if (due) {
        syncReminderInCache(queryClient, updated);
        void import("./reminder-notifications").then(({ syncBookmarkReminder }) =>
          syncBookmarkReminder(updated),
        );
        void queryClient.invalidateQueries({ queryKey: qk.reminders });
      }
      if (!bookmark.isRead) void queryClient.invalidateQueries({ queryKey: qk.folders });
    })
    .catch(() => {
      updateBookmarkEverywhere(queryClient, bookmark.id, (current) => ({
        ...current,
        isRead: previous.isRead,
        remindAt: previous.remindAt,
      }));
      if (!bookmark.isRead) bumpFolderCount(queryClient, bookmark.folderId, 0, 1);
      if (due) {
        syncReminderInCache(queryClient, {
          id: bookmark.id,
          folderId: bookmark.folderId,
          title: bookmark.title,
          remindAt: previous.remindAt,
        });
      }
    });
}

/** Open the live page in the device browser app, even if websites usually stay in ordo. */
export function openBookmarkInExternalBrowser(bookmark: BookmarkDto): void {
  ackBookmarkOpened(bookmark);
  void openExternalBrowser(bookmark.url);
}

/**
 * Open a library bookmark. Returns after handing off to a system browser, or
 * calls `openReader` when the page should stay in ordo.
 */
export function openListBookmark(bookmark: BookmarkDto, openReader: () => void): void {
  const browser = websiteBrowser();
  if (bookmarkOpensAsWebsite(bookmark) && browser !== "ordo") {
    ackBookmarkOpened(bookmark);
    void openLivePage(bookmark.url, browser);
    return;
  }
  openReader();
}
