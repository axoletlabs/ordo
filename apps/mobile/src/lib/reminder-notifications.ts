/**
 * Local OS notifications for bookmark reminders. The server stores unix
 * seconds; this module schedules (or immediately presents) the ping on device.
 */
import { Platform } from "react-native";
import type { BookmarkDto, BookmarkReminderDto } from "@ordo/shared";
import { unixSeconds } from "@ordo/shared";
import {
  REMINDER_PING_CATEGORY,
  REMINDER_PING_LATER,
  REMINDER_PING_OPEN,
  reminderNotificationCopy,
  reminderPingAction,
  reminderPingPayload,
  type ReminderPingPayload,
} from "./bookmark-reminders";
import { prefsGet, prefsSet, StorageKeys } from "./storage";

const CHANNEL_ID = "reminders";
const ID_PREFIX = "ordo-reminder:";
const FIRED_KEY = StorageKeys.REMINDER_FIRED;

type NotificationsModule = typeof import("expo-notifications");
type ReminderPingRow = Pick<BookmarkReminderDto, "id" | "folderId" | "title" | "domain" | "remindAt">;

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
  try {
    await mod.setNotificationCategoryAsync(REMINDER_PING_CATEGORY, [
      {
        identifier: REMINDER_PING_LATER,
        buttonTitle: "Later",
        options: { opensAppToForeground: false },
      },
      {
        identifier: REMINDER_PING_OPEN,
        buttonTitle: "Open",
        options: { opensAppToForeground: true },
      },
    ]);
  } catch {
    /* categories unavailable */
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

async function dismissId(mod: NotificationsModule, bookmarkId: string): Promise<void> {
  try {
    await mod.dismissNotificationAsync(identifier(bookmarkId));
  } catch {
    /* already gone */
  }
}

function notificationContent(row: ReminderPingRow) {
  const copy = reminderNotificationCopy(row);
  return {
    title: copy.title,
    body: copy.body ?? null,
    categoryIdentifier: REMINDER_PING_CATEGORY,
    data: {
      bookmarkId: row.id,
      folderId: row.folderId,
      title: row.title,
      domain: row.domain,
    },
    sound: true as const,
    ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : null),
  };
}

function asPingRow(
  row: Pick<BookmarkDto, "id" | "title" | "remindAt"> &
    Partial<Pick<BookmarkDto, "folderId" | "domain">>,
  remindAt: number,
): ReminderPingRow {
  return {
    id: row.id,
    folderId: row.folderId ?? null,
    title: row.title,
    domain: row.domain ?? "",
    remindAt,
  };
}

async function presentDue(mod: NotificationsModule, row: ReminderPingRow): Promise<void> {
  const map = await loadFired();
  if (map[row.id] === row.remindAt) return;
  await mod.scheduleNotificationAsync({
    identifier: identifier(row.id),
    content: notificationContent(row),
    trigger: null,
  });
  await rememberFired(row.id, row.remindAt);
}

async function scheduleFuture(mod: NotificationsModule, row: ReminderPingRow): Promise<void> {
  await cancelId(mod, row.id);
  await dismissId(mod, row.id);
  await forgetFired(row.id);
  await mod.scheduleNotificationAsync({
    identifier: identifier(row.id),
    content: notificationContent(row),
    trigger: {
      type: mod.SchedulableTriggerInputTypes.DATE,
      date: new Date(row.remindAt * 1000),
      channelId: Platform.OS === "android" ? CHANNEL_ID : undefined,
    },
  });
}

export async function syncBookmarkReminder(
  bookmark: Pick<BookmarkDto, "id" | "title" | "remindAt"> &
    Partial<Pick<BookmarkDto, "folderId" | "domain">>,
): Promise<boolean> {
  const mod = await loadNotifications();
  if (!mod) return false;
  await ensureHandler(mod);
  if (bookmark.remindAt == null) {
    await cancelId(mod, bookmark.id);
    await dismissId(mod, bookmark.id);
    await forgetFired(bookmark.id);
    return true;
  }
  const allowed = await ensureReminderPermissions();
  if (!allowed) return false;
  const row = asPingRow(bookmark, bookmark.remindAt);
  if (bookmark.remindAt <= unixSeconds()) {
    await cancelId(mod, bookmark.id);
    await presentDue(mod, row);
    return true;
  }
  await scheduleFuture(mod, row);
  return true;
}

export async function cancelBookmarkReminder(bookmarkId: string): Promise<void> {
  const mod = await loadNotifications();
  if (!mod) return;
  await cancelId(mod, bookmarkId);
  await dismissId(mod, bookmarkId);
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

export function subscribeReminderNotificationTaps(handlers: {
  onOpen: (payload: ReminderPingPayload) => void;
  onLater: (payload: ReminderPingPayload) => void;
}): () => void {
  if (!nativeOk()) return () => undefined;
  let remove: (() => void) | undefined;
  void (async () => {
    const mod = await loadNotifications();
    if (!mod) return;
    await ensureHandler(mod);
    const last = consumedLaunchResponse ? null : await mod.getLastNotificationResponseAsync();
    consumedLaunchResponse = true;
    const deliver = (actionIdentifier: string, data: unknown) => {
      const payload = reminderPingPayload(data);
      if (!payload) return;
      const kind =
        reminderPingAction(actionIdentifier) ??
        (actionIdentifier === mod.DEFAULT_ACTION_IDENTIFIER ? "open" : null);
      if (kind === "later") handlers.onLater(payload);
      else if (kind === "open") handlers.onOpen(payload);
    };
    if (last) {
      deliver(last.actionIdentifier, last.notification.request.content.data);
    }
    const sub = mod.addNotificationResponseReceivedListener((response) => {
      deliver(response.actionIdentifier, response.notification.request.content.data);
    });
    remove = () => sub.remove();
  })();
  return () => remove?.();
}
