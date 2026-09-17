/**
 * Local OS notifications for bookmark reminders. The server stores unix
 * seconds; this module schedules (or immediately presents) the ping on device.
 */
import { Platform } from "react-native";
import type { BookmarkDto, BookmarkReminderDto } from "@ordo/shared";
import { unixSeconds } from "@ordo/shared";
import { prefsGet, prefsSet, StorageKeys } from "./storage";

const CHANNEL_ID = "reminders";
const ID_PREFIX = "ordo-reminder:";
const FIRED_KEY = StorageKeys.REMINDER_FIRED;

type NotificationsModule = typeof import("expo-notifications");

let notifications: NotificationsModule | null | undefined;
let handlerReady = false;
let consumedLaunchResponse = false;
let fired: Record<string, number> = {};
let firedLoaded = false;

function nativeOk(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!nativeOk()) return null;
  if (notifications !== undefined) return notifications;
  try {
    notifications = await import("expo-notifications");
  } catch {
    notifications = null;
  }
  return notifications;
}

function identifier(bookmarkId: string): string {
  return `${ID_PREFIX}${bookmarkId}`;
}

async function loadFired(): Promise<Record<string, number>> {
  if (firedLoaded) return fired;
  firedLoaded = true;
  const stored = await prefsGet<Record<string, number>>(FIRED_KEY);
  fired = stored && typeof stored === "object" ? stored : {};
  return fired;
}

async function rememberFired(bookmarkId: string, remindAt: number): Promise<void> {
  const map = await loadFired();
  if (map[bookmarkId] === remindAt) return;
  map[bookmarkId] = remindAt;
  fired = map;
  await prefsSet(FIRED_KEY, map);
}

async function forgetFired(bookmarkId: string): Promise<void> {
  const map = await loadFired();
  if (!(bookmarkId in map)) return;
  delete map[bookmarkId];
  fired = map;
  await prefsSet(FIRED_KEY, map);
}

async function ensureHandler(mod: NotificationsModule): Promise<void> {
  if (handlerReady) return;
  handlerReady = true;
  mod.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    await mod.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Reminders",
      importance: mod.AndroidImportance.HIGH,
    });
  }
}

export async function ensureReminderPermissions(): Promise<boolean> {
  const mod = await loadNotifications();
  if (!mod) return false;
  await ensureHandler(mod);
  const existing = await mod.getPermissionsAsync();
  if (existing.granted || existing.status === "granted") return true;
  const requested = await mod.requestPermissionsAsync();
  return requested.granted || requested.status === "granted";
}

async function cancelId(mod: NotificationsModule, bookmarkId: string): Promise<void> {
  try {
    await mod.cancelScheduledNotificationAsync(identifier(bookmarkId));
  } catch {
    /* already gone */
  }
}

function notificationContent(row: { id: string; title: string }, body: string) {
  return {
    title: row.title || "Reminder",
    body,
    data: { bookmarkId: row.id },
    sound: true as const,
    ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : null),
  };
}

async function presentDue(
  mod: NotificationsModule,
  row: { id: string; title: string; remindAt: number },
): Promise<void> {
  const map = await loadFired();
  if (map[row.id] === row.remindAt) return;
  await mod.scheduleNotificationAsync({
    identifier: identifier(row.id),
    content: notificationContent(row, "This bookmark is due."),
    trigger: null,
  });
  await rememberFired(row.id, row.remindAt);
}

async function scheduleFuture(
  mod: NotificationsModule,
  row: { id: string; title: string; remindAt: number },
): Promise<void> {
  await cancelId(mod, row.id);
  await forgetFired(row.id);
  await mod.scheduleNotificationAsync({
    identifier: identifier(row.id),
    content: notificationContent(row, "Time to read this bookmark."),
    trigger: {
      type: mod.SchedulableTriggerInputTypes.DATE,
      date: new Date(row.remindAt * 1000),
      channelId: Platform.OS === "android" ? CHANNEL_ID : undefined,
    },
  });
}

export async function syncBookmarkReminder(
  bookmark: Pick<BookmarkDto, "id" | "title" | "remindAt">,
): Promise<boolean> {
  const mod = await loadNotifications();
  if (!mod) return false;
  await ensureHandler(mod);
  if (bookmark.remindAt == null) {
    await cancelId(mod, bookmark.id);
    await forgetFired(bookmark.id);
    return true;
  }
  const allowed = await ensureReminderPermissions();
  if (!allowed) return false;
  if (bookmark.remindAt <= unixSeconds()) {
    await cancelId(mod, bookmark.id);
    await presentDue(mod, { id: bookmark.id, title: bookmark.title, remindAt: bookmark.remindAt });
    return true;
  }
  await scheduleFuture(mod, { id: bookmark.id, title: bookmark.title, remindAt: bookmark.remindAt });
  return true;
}

export async function cancelBookmarkReminder(bookmarkId: string): Promise<void> {
  const mod = await loadNotifications();
  if (!mod) return;
  await cancelId(mod, bookmarkId);
  await forgetFired(bookmarkId);
}

export async function reconcileReminderNotifications(
  rows: readonly BookmarkReminderDto[],
): Promise<void> {
  const mod = await loadNotifications();
  if (!mod) return;
  await ensureHandler(mod);
  const allowed = await ensureReminderPermissions();
  const wanted = new Set(rows.map((row) => row.id));
  try {
    const scheduled = await mod.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      const id = item.identifier;
      if (!id.startsWith(ID_PREFIX)) continue;
      const bookmarkId = id.slice(ID_PREFIX.length);
      if (!wanted.has(bookmarkId)) await cancelId(mod, bookmarkId);
    }
  } catch {
    /* ignore */
  }
  if (!allowed) return;
  const now = unixSeconds();
  for (const row of rows) {
    if (row.remindAt <= now) {
      await cancelId(mod, row.id);
      await presentDue(mod, row);
    } else {
      await scheduleFuture(mod, row);
    }
  }
}

export function subscribeReminderNotificationTaps(onOpen: (bookmarkId: string) => void): () => void {
  if (!nativeOk()) return () => undefined;
  let remove: (() => void) | undefined;
  void (async () => {
    const mod = await loadNotifications();
    if (!mod) return;
    await ensureHandler(mod);
    const last = consumedLaunchResponse ? null : await mod.getLastNotificationResponseAsync();
    consumedLaunchResponse = true;
    const coldId = last?.notification.request.content.data?.bookmarkId;
    if (typeof coldId === "string" && coldId) onOpen(coldId);
    const sub = mod.addNotificationResponseReceivedListener((response) => {
      const id = response.notification.request.content.data?.bookmarkId;
      if (typeof id === "string" && id) onOpen(id);
    });
    remove = () => sub.remove();
  })();
  return () => remove?.();
}
