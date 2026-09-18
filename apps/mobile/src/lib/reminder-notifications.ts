/**
 * Local OS notifications for bookmark reminders. The server stores unix
 * seconds; this module schedules (or immediately presents) the ping on device.
 */
import { Platform } from "react-native";
import type { BookmarkDto, BookmarkReminderDto } from "@ordo/shared";
import { unixSeconds } from "@ordo/shared";
import {
  REMINDER_PING_CATEGORY,
  REMINDER_PING_COMPLETE,
  REMINDER_PING_OPEN,
  REMINDER_PING_RESCHEDULE,
  reminderNotificationCopy,
  reminderPingAction,
  reminderPingPayload,
  reminderPingPlan,
  scheduledTriggerUnix,
  type ReminderPingKind,
  type ReminderPingPayload,
} from "./bookmark-reminders";
import { prefsGet, prefsSet, StorageKeys } from "./storage";

const CHANNEL_ID = "reminders";
const ID_PREFIX = "ordo-reminder:";
const FIRED_KEY = StorageKeys.REMINDER_FIRED;

type NotificationsModule = typeof import("expo-notifications");
type ReminderPingRow = Pick<BookmarkReminderDto, "id" | "folderId" | "title" | "domain" | "remindAt">;
type TapHandlers = {
  onOpen: (payload: ReminderPingPayload) => void;
  onComplete: (payload: ReminderPingPayload) => void;
  onReschedule: (payload: ReminderPingPayload) => void;
};

let notifications: NotificationsModule | null | undefined;
let handlerReady = false;
let receivedBound = false;
let consumedLaunchResponse = false;
let bootPromise: Promise<void> | null = null;
let tapHandlers: TapHandlers | null = null;
let queuedTap: { kind: ReminderPingKind; payload: ReminderPingPayload } | null = null;
const seenResponseKeys = new Set<string>();
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
  if (!handlerReady) {
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
  try {
    await mod.setNotificationCategoryAsync(
      REMINDER_PING_CATEGORY,
      [
        {
          identifier: REMINDER_PING_COMPLETE,
          buttonTitle: "Complete",
          options: { opensAppToForeground: false },
        },
        {
          identifier: REMINDER_PING_OPEN,
          buttonTitle: "Open",
          options: { opensAppToForeground: true },
        },
        {
          identifier: REMINDER_PING_RESCHEDULE,
          buttonTitle: "Reschedule",
          options: { opensAppToForeground: true },
        },
      ],
      {
        previewPlaceholder: "Reminder",
        showTitle: true,
        showSubtitle: true,
      },
    );
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
    subtitle: copy.subtitle,
    body: copy.body ?? null,
    categoryIdentifier: REMINDER_PING_CATEGORY,
    data: {
      bookmarkId: row.id,
      folderId: row.folderId,
      title: row.title,
      domain: row.domain,
      remindAt: row.remindAt,
    },
    sound: true as const,
    autoDismiss: true,
    ...(Platform.OS === "android"
      ? { channelId: CHANNEL_ID, priority: "high", color: "#ED6F5C" }
      : null),
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

async function presentedIds(mod: NotificationsModule): Promise<Set<string>> {
  try {
    const presented = await mod.getPresentedNotificationsAsync();
    return new Set(
      presented
        .map((item) => item.request.identifier)
        .filter((id): id is string => typeof id === "string" && id.startsWith(ID_PREFIX)),
    );
  } catch {
    return new Set();
  }
}

async function scheduledAtByBookmark(mod: NotificationsModule): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  try {
    const scheduled = await mod.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      const id = item.identifier;
      if (!id.startsWith(ID_PREFIX)) continue;
      map.set(id.slice(ID_PREFIX.length), scheduledTriggerUnix(item.trigger));
    }
  } catch {
    /* ignore */
  }
  return map;
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
  const map = await loadFired();
  if (map[row.id] !== row.remindAt) await forgetFired(row.id);
  await cancelId(mod, row.id);
  await dismissId(mod, row.id);
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

async function applyPing(
  mod: NotificationsModule,
  row: ReminderPingRow,
  now: number,
  scheduledAt: number | null | undefined,
  presented: boolean,
): Promise<void> {
  const map = await loadFired();
  const plan = reminderPingPlan({
    remindAt: row.remindAt,
    now,
    firedAt: map[row.id],
    scheduledAt,
    presented,
  });
  if (plan === "skip") return;
  if (plan === "present") {
    await cancelId(mod, row.id);
    await presentDue(mod, row);
    return;
  }
  await scheduleFuture(mod, row);
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
  const [scheduled, presented] = await Promise.all([scheduledAtByBookmark(mod), presentedIds(mod)]);
  await applyPing(
    mod,
    asPingRow(bookmark, bookmark.remindAt),
    unixSeconds(),
    scheduled.get(bookmark.id),
    presented.has(identifier(bookmark.id)),
  );
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
  await reminderNotificationsReady();
  const mod = await loadNotifications();
  if (!mod) return;
  await ensureHandler(mod);
  const allowed = await ensureReminderPermissions();
  const wanted = new Set(rows.map((row) => row.id));
  const [scheduled, presented] = await Promise.all([scheduledAtByBookmark(mod), presentedIds(mod)]);
  for (const bookmarkId of scheduled.keys()) {
    if (wanted.has(bookmarkId)) continue;
    await cancelId(mod, bookmarkId);
    await dismissId(mod, bookmarkId);
    await forgetFired(bookmarkId);
  }
  if (!allowed) return;
  const now = unixSeconds();
  for (const row of rows) {
    await applyPing(
      mod,
      row,
      now,
      scheduled.get(row.id),
      presented.has(identifier(row.id)),
    );
  }
}

export async function markReminderPingHandled(payload: ReminderPingPayload): Promise<void> {
  if (payload.remindAt != null) await rememberFired(payload.bookmarkId, payload.remindAt);
  const mod = await loadNotifications();
  if (!mod) return;
  await dismissId(mod, payload.bookmarkId);
  await cancelId(mod, payload.bookmarkId);
}

function responseKey(actionIdentifier: string, notification: { date?: unknown; request: { identifier: string } }) {
  return `${actionIdentifier}:${notification.request.identifier}:${String(notification.date ?? "")}`;
}

function rememberResponseKey(key: string): boolean {
  if (seenResponseKeys.has(key)) return false;
  seenResponseKeys.add(key);
  if (seenResponseKeys.size > 40) {
    const first = seenResponseKeys.values().next().value;
    if (first) seenResponseKeys.delete(first);
  }
  return true;
}

function emitTap(kind: ReminderPingKind, payload: ReminderPingPayload) {
  if (!tapHandlers) {
    queuedTap = { kind, payload };
    return;
  }
  if (kind === "complete") tapHandlers.onComplete(payload);
  else if (kind === "open") tapHandlers.onOpen(payload);
  else tapHandlers.onReschedule(payload);
}

async function handleResponse(
  mod: NotificationsModule,
  actionIdentifier: string,
  notification: { date?: unknown; request: { identifier: string; content: { data?: unknown } } },
): Promise<void> {
  const key = responseKey(actionIdentifier, notification);
  if (!rememberResponseKey(key)) return;
  const payload = reminderPingPayload(notification.request.content.data);
  if (!payload) return;
  const kind =
    reminderPingAction(actionIdentifier) ??
    (actionIdentifier === mod.DEFAULT_ACTION_IDENTIFIER ? "open" : null);
  if (!kind) return;
  await markReminderPingHandled(payload);
  emitTap(kind, payload);
}

async function bootReminderNotifications(): Promise<void> {
  const mod = await loadNotifications();
  if (!mod) return;
  await ensureHandler(mod);
  await loadFired();
  if (!receivedBound) {
    receivedBound = true;
    mod.addNotificationReceivedListener((notification) => {
      const payload = reminderPingPayload(notification.request.content.data);
      if (!payload?.remindAt) return;
      void rememberFired(payload.bookmarkId, payload.remindAt);
    });
    mod.addNotificationResponseReceivedListener((response) => {
      void handleResponse(mod, response.actionIdentifier, response.notification);
    });
  }
  if (!consumedLaunchResponse) {
    consumedLaunchResponse = true;
    try {
      const last = await mod.getLastNotificationResponseAsync();
      if (last) {
        await handleResponse(mod, last.actionIdentifier, last.notification);
        const id = last.notification.request.identifier;
        if (typeof id === "string" && id.startsWith(ID_PREFIX)) {
          await mod.clearLastNotificationResponseAsync();
        }
      }
    } catch {
      /* no launch response */
    }
  }
}

export function reminderNotificationsReady(): Promise<void> {
  if (!nativeOk()) return Promise.resolve();
  bootPromise ??= bootReminderNotifications();
  return bootPromise;
}

export function subscribeReminderNotificationTaps(handlers: TapHandlers): () => void {
  if (!nativeOk()) return () => undefined;
  tapHandlers = handlers;
  if (queuedTap) {
    const queued = queuedTap;
    queuedTap = null;
    emitTap(queued.kind, queued.payload);
  }
  void reminderNotificationsReady();
  return () => {
    if (tapHandlers === handlers) tapHandlers = null;
  };
}

void reminderNotificationsReady();
