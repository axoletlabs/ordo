/**
 * Local OS notifications for bookmark reminders. The server stores unix
 * seconds; this module schedules (or immediately presents) the ping on device.
 */
import { Platform } from "react-native";
import type { BookmarkDto, BookmarkReminderDto } from "@ordo/shared";
import { unixSeconds } from "@ordo/shared";
import {
  REMINDER_PING_CATEGORY,
  REMINDER_PING_CATEGORY_LEGACY,
  REMINDER_PING_ID_PREFIX,
  REMINDER_PING_OPEN,
  REMINDER_PING_RESCHEDULE,
  reminderNotificationCopy,
  reminderNotificationIdentifier,
  reminderPingAction,
  reminderPingFromNotification,
  reminderPingPlan,
  scheduledTriggerUnix,
  shouldOpenExactAlarmSettings,
  type ReminderPingKind,
  type ReminderPingPayload,
} from "./bookmark-reminders";
import { prefsGet, prefsSet, StorageKeys } from "./storage";

const CHANNEL_ID = "reminders";
const FIRED_KEY = StorageKeys.REMINDER_FIRED;
/** Bump when shade actions change so already-presented pings get new PendingIntents. */
const ACTIONS_REV = 5;
const CATEGORY_OPTIONS = {
  previewPlaceholder: "Reminder",
  showTitle: true,
  showSubtitle: false,
} as const;

type NotificationsModule = typeof import("expo-notifications");
type NotificationTriggerInput = import("expo-notifications").NotificationTriggerInput;
type CalendarTriggerInput = import("expo-notifications").CalendarTriggerInput;
type DateTriggerInput = import("expo-notifications").DateTriggerInput;
type ReminderPingRow = Pick<
  BookmarkReminderDto,
  "id" | "folderId" | "title" | "domain" | "description" | "remindAt"
>;
type TapHandlers = {
  onOpen: (payload: ReminderPingPayload) => void;
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
let exactAlarmScreenShown = false;

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
  return reminderNotificationIdentifier(bookmarkId);
}

function reminderActions() {
  return [
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
  ];
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
        enableVibrate: true,
        lockscreenVisibility: mod.AndroidNotificationVisibility.PUBLIC,
      });
    }
  }
  try {
    const actions = reminderActions();
    await mod.setNotificationCategoryAsync(REMINDER_PING_CATEGORY, actions, CATEGORY_OPTIONS);
    await mod.setNotificationCategoryAsync(REMINDER_PING_CATEGORY_LEGACY, actions, CATEGORY_OPTIONS);
  } catch {
    /* categories unavailable */
  }
  await refreshPresentedReminderActions(mod);
}

async function refreshPresentedReminderActions(mod: NotificationsModule): Promise<void> {
  const rev = await prefsGet<number>(StorageKeys.REMINDER_ACTIONS_REV);
  if (rev === ACTIONS_REV) return;
  try {
    const presented = await mod.getPresentedNotificationsAsync();
    for (const item of presented) {
      const requestId = item.request.identifier;
      if (typeof requestId !== "string") continue;
      const content = item.request.content as { data?: unknown; dataString?: unknown };
      const payload = reminderPingFromNotification({
        identifier: requestId,
        data: content.data,
        dataString: content.dataString,
      });
      if (!payload) continue;
      const remindAt = payload.remindAt ?? unixSeconds();
      const row = asPingRow(
        {
          id: payload.bookmarkId,
          folderId: payload.folderId,
          title: payload.title,
          domain: payload.domain,
          description: payload.description,
          remindAt,
        },
        remindAt,
      );
      const nextId = identifier(payload.bookmarkId);
      await mod.scheduleNotificationAsync({
        identifier: nextId,
        content: { ...notificationContent(row), sound: false },
        trigger: null,
      });
      if (requestId !== nextId) {
        try {
          await mod.dismissNotificationAsync(requestId);
        } catch {
          /* already gone */
        }
      }
    }
    await prefsSet(StorageKeys.REMINDER_ACTIONS_REV, ACTIONS_REV);
  } catch {
    /* retry on the next ensureHandler */
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
  await dismissReminderShade(mod, bookmarkId);
}

async function dismissReminderShade(
  mod: NotificationsModule,
  bookmarkId: string,
  requestIdentifier?: string,
): Promise<void> {
  const ids = new Set<string>();
  if (requestIdentifier) ids.add(requestIdentifier);
  ids.add(identifier(bookmarkId));
  try {
    const presented = await mod.getPresentedNotificationsAsync();
    for (const item of presented) {
      const requestId = item.request.identifier;
      if (typeof requestId !== "string") continue;
      const content = item.request.content as { data?: unknown; dataString?: unknown };
      const payload = reminderPingFromNotification({
        identifier: requestId,
        data: content.data,
        dataString: content.dataString,
      });
      if (payload?.bookmarkId === bookmarkId) ids.add(requestId);
    }
  } catch {
    /* presented list unavailable */
  }
  for (const id of ids) {
    try {
      await mod.dismissNotificationAsync(id);
    } catch {
      /* already gone */
    }
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
      description: row.description ?? "",
      remindAt: row.remindAt,
    },
    sound: true as const,
    interruptionLevel: "timeSensitive" as const,
    autoDismiss: true,
    ...(Platform.OS === "android"
      ? { channelId: CHANNEL_ID, priority: "high", color: "#ED6F5C" }
      : null),
  };
}

function asPingRow(
  row: Pick<BookmarkDto, "id" | "title" | "remindAt"> &
    Partial<Pick<BookmarkDto, "folderId" | "domain" | "description">>,
  remindAt: number,
): ReminderPingRow {
  return {
    id: row.id,
    folderId: row.folderId ?? null,
    title: row.title,
    domain: row.domain ?? "",
    description: row.description ?? null,
    remindAt,
  };
}

async function presentedIds(mod: NotificationsModule): Promise<Set<string>> {
  try {
    const presented = await mod.getPresentedNotificationsAsync();
    return new Set(
      presented
        .map((item) => item.request.identifier)
        .filter((id): id is string => typeof id === "string" && id.startsWith(REMINDER_PING_ID_PREFIX)),
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
      if (!id.startsWith(REMINDER_PING_ID_PREFIX)) continue;
      map.set(id.slice(REMINDER_PING_ID_PREFIX.length), scheduledTriggerUnix(item.trigger));
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

function androidApiLevel(): number {
  const api = typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version);
  return Number.isFinite(api) ? api : 0;
}

async function ensureExactAlarms(): Promise<void> {
  if (Platform.OS !== "android") return;
  if (
    !shouldOpenExactAlarmSettings({
      os: Platform.OS,
      apiLevel: androidApiLevel(),
      alreadyAsked: false,
    })
  ) {
    return;
  }
  if (exactAlarmScreenShown) return;
  exactAlarmScreenShown = true;
  if ((await prefsGet<boolean>(StorageKeys.REMINDER_EXACT_ALARM_ASKED)) === true) return;
  // Remember before opening: returning from Settings can reload JS, and
  // PermissionsAndroid cannot read this app-op so a check would look denied.
  await prefsSet(StorageKeys.REMINDER_EXACT_ALARM_ASKED, true);
  try {
    const IntentLauncher = await import("expo-intent-launcher");
    const Constants = (await import("expo-constants")).default;
    const pkg = Constants.expoConfig?.android?.package ?? "com.axolet.ordo";
    await IntentLauncher.startActivityAsync("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", {
      data: `package:${pkg}`,
    });
  } catch {
    /* settings screen unavailable */
  }
}

function futureTrigger(mod: NotificationsModule, remindAt: number): NotificationTriggerInput {
  const date = new Date(remindAt * 1000);
  if (Platform.OS === "ios") {
    const trigger: CalendarTriggerInput = {
      type: mod.SchedulableTriggerInputTypes.CALENDAR as CalendarTriggerInput["type"],
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      repeats: false,
    };
    return trigger;
  }
  const trigger: DateTriggerInput = {
    type: mod.SchedulableTriggerInputTypes.DATE as DateTriggerInput["type"],
    date,
    channelId: CHANNEL_ID,
  };
  return trigger;
}

async function scheduleFuture(mod: NotificationsModule, row: ReminderPingRow): Promise<void> {
  const map = await loadFired();
  if (map[row.id] !== row.remindAt) await forgetFired(row.id);
  await dismissId(mod, row.id);
  await ensureExactAlarms();
  try {
    await mod.scheduleNotificationAsync({
      identifier: identifier(row.id),
      content: notificationContent(row),
      trigger: futureTrigger(mod, row.remindAt),
    });
  } catch {
    /* OS refused the DATE (often missing exact-alarm permission) */
  }
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

export async function markReminderPingHandled(
  payload: ReminderPingPayload,
  requestIdentifier?: string,
): Promise<void> {
  if (payload.remindAt != null) await rememberFired(payload.bookmarkId, payload.remindAt);
  const mod = await loadNotifications();
  if (!mod) return;
  await dismissReminderShade(mod, payload.bookmarkId, requestIdentifier);
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
  if (kind === "open") tapHandlers.onOpen(payload);
  else tapHandlers.onReschedule(payload);
}

async function handleResponse(
  mod: NotificationsModule,
  actionIdentifier: string,
  notification: {
    date?: unknown;
    request: { identifier: string; content: { data?: unknown; dataString?: unknown } };
  },
): Promise<void> {
  const payload = reminderPingFromNotification({
    identifier: notification.request.identifier,
    data: notification.request.content.data,
    dataString: notification.request.content.dataString,
  });
  if (!payload) return;
  const kind =
    reminderPingAction(actionIdentifier) ??
    (actionIdentifier === mod.DEFAULT_ACTION_IDENTIFIER ? "open" : null);
  if (!kind) return;
  const key = responseKey(actionIdentifier, notification);
  if (!rememberResponseKey(key)) return;
  await markReminderPingHandled(payload, notification.request.identifier);
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
      const content = notification.request.content as { data?: unknown; dataString?: unknown };
      const payload = reminderPingFromNotification({
        identifier: notification.request.identifier,
        data: content.data,
        dataString: content.dataString,
      });
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
        if (typeof id === "string" && id.startsWith(REMINDER_PING_ID_PREFIX)) {
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
