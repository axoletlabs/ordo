/**
 * Local-time reminder presets and display. Storage is unix seconds; every
 * string shown to the user is formatted in the device timezone.
 */
import { reminderStatus, unixSeconds, type ReminderStatus } from "@ordo/shared";

export type ReminderPresetId = "1h" | "3h" | "tomorrow" | "nextWeek";

export interface ReminderPreset {
  id: ReminderPresetId;
  label: string;
}

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  { id: "1h", label: "In 1 hour" },
  { id: "3h", label: "In 3 hours" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "nextWeek", label: "Next week" },
];

function padTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function weekday(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatLocalTime(unix: number): string {
  return padTime(new Date(unix * 1000));
}

export function reminderPresetAt(id: ReminderPresetId, now = new Date()): number {
  if (id === "1h") return unixSeconds(now.getTime() + 60 * 60 * 1000);
  if (id === "3h") return unixSeconds(now.getTime() + 3 * 60 * 60 * 1000);
  if (id === "tomorrow") {
    return unixSeconds(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0));
  }
  const day = now.getDay();
  const daysUntilMonday = ((1 - day + 7) % 7) || 7;
  return unixSeconds(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday, 9, 0, 0, 0),
  );
}

export function reminderPresetDetail(id: ReminderPresetId, at: number): string {
  const date = new Date(at * 1000);
  const time = padTime(date);
  if (id === "nextWeek") return `${weekday(date)} ${time}`;
  return time;
}

function formatLocalWhen(unix: number, now: Date): string {
  const date = new Date(unix * 1000);
  const time = padTime(date);
  if (startOfLocalDay(date).getTime() === startOfLocalDay(now).getTime()) return time;
  const deltaDays = Math.round(
    (startOfLocalDay(date).getTime() - startOfLocalDay(now).getTime()) / 86_400_000,
  );
  if (deltaDays > -7 && deltaDays < 7 && deltaDays !== 0) return `${weekday(date)} ${time}`;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

/** Compact local label for a row or menu trailing value. */
export function formatReminderWhen(unix: number, now = new Date()): string {
  const when = formatLocalWhen(unix, now);
  if (reminderStatus(unix, unixSeconds(now)) === "due") return `Due ${when}`;
  return when;
}

/** Due reminders clear when the bookmark is opened; upcoming ones stay. */
export function reminderClearsOnOpen(
  remindAt: number | null | undefined,
  now = new Date(),
): boolean {
  return reminderStatus(remindAt, unixSeconds(now)) === "due";
}

/** Longer local datetime for toasts and the custom panel. */
export function formatReminderFull(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function reminderSetToast(unix: number): string {
  return `Reminder set for ${formatReminderFull(unix)}`;
}

export function reminderClearedToast(): string {
  return "Reminder cleared";
}

/** One hour out — the in-app "In 1 hour" preset. */
export function reminderLaterAt(now = new Date()): number {
  return reminderPresetAt("1h", now);
}

function collapseNotificationText(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

function isRedundantNotificationDescription(title: string, description: string): boolean {
  if (!title || !description) return false;
  if (description === title) return true;
  return (
    description.startsWith(title) &&
    description.length > title.length &&
    !/\s/.test(description[title.length]!)
  );
}

const NOTIFICATION_BODY_MAX = 220;

function clipNotificationBody(text: string): string {
  if (text.length <= NOTIFICATION_BODY_MAX) return text;
  const slice = text.slice(0, NOTIFICATION_BODY_MAX);
  const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  return `${(breakAt > 80 ? slice.slice(0, breakAt) : slice).trimEnd()}…`;
}

/**
 * Collapsed shade is the title. Expanded body is the standfirst when we have
 * one, otherwise the host — no type chip, no instruction.
 */
export function reminderNotificationCopy(row: {
  title: string;
  description?: string | null;
  domain?: string | null;
}): { title: string; body?: string } {
  const title = collapseNotificationText(row.title) || "Saved page";
  const description = collapseNotificationText(row.description);
  const host = collapseNotificationText(row.domain);
  const raw =
    description && !isRedundantNotificationDescription(title, description)
      ? description
      : host && host !== title
        ? host
        : "";
  if (!raw) return { title };
  return { title, body: clipNotificationBody(raw) };
}

/** expo-notifications: `:` / `-` in a category id can break action buttons. */
export const REMINDER_PING_CATEGORY = "ordoReminder";
/** Trays scheduled before the category id dropped its hyphen. */
export const REMINDER_PING_CATEGORY_LEGACY = "ordo-reminder";
export const REMINDER_PING_ID_PREFIX = "ordo-reminder:";
export const REMINDER_PING_OPEN = "open";
export const REMINDER_PING_RESCHEDULE = "reschedule";
/** Matches expo-notifications `DEFAULT_ACTION_IDENTIFIER`. */
export const REMINDER_PING_DEFAULT = "expo.modules.notifications.actions.DEFAULT";

export function reminderNotificationIdentifier(bookmarkId: string): string {
  return `${REMINDER_PING_ID_PREFIX}${bookmarkId}`;
}

export function bookmarkIdFromReminderIdentifier(identifier: string): string | null {
  if (!identifier.startsWith(REMINDER_PING_ID_PREFIX)) return null;
  const id = identifier.slice(REMINDER_PING_ID_PREFIX.length);
  return id || null;
}

export type ReminderPingKind = "open" | "reschedule";

export type ReminderPingPayload = {
  bookmarkId: string;
  folderId: string | null;
  title: string;
  domain: string;
  description: string;
  remindAt: number | null;
};

export function reminderPingAction(actionIdentifier: string): ReminderPingKind | null {
  if (actionIdentifier === REMINDER_PING_RESCHEDULE) return "reschedule";
  if (actionIdentifier === REMINDER_PING_OPEN || actionIdentifier === REMINDER_PING_DEFAULT) {
    return "open";
  }
  return null;
}

/** Unix seconds from notification data / native DATE triggers (seconds or ms). */
export function parseUnixSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.trunc(value / 1000) : Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseUnixSeconds(Number(trimmed));
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed / 1000);
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isFinite(ms) && ms > 0) return Math.trunc(ms / 1000);
  }
  return null;
}

/** Next fire time from a scheduled expo-notifications trigger blob. */
export function scheduledTriggerUnix(trigger: unknown): number | null {
  if (!trigger || typeof trigger !== "object") return null;
  const record = trigger as Record<string, unknown>;
  return (
    parseUnixSeconds(record.value) ??
    parseUnixSeconds(record.date) ??
    parseUnixSeconds(record.timestamp) ??
    calendarTriggerUnix(record)
  );
}

function asDateComponent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

/** Absolute wall time from an iOS UNCalendarNotificationTrigger payload. */
export function calendarTriggerUnix(trigger: Record<string, unknown>): number | null {
  const year = asDateComponent(trigger.year);
  const month = asDateComponent(trigger.month);
  const day = asDateComponent(trigger.day);
  const hour = asDateComponent(trigger.hour);
  const minute = asDateComponent(trigger.minute);
  if (year == null || month == null || day == null || hour == null || minute == null) return null;
  const monthIndex = month >= 1 && month <= 12 ? month - 1 : month;
  if (monthIndex < 0 || monthIndex > 11) return null;
  const second = asDateComponent(trigger.second) ?? 0;
  const date = new Date(year, monthIndex, day, hour, minute, second, 0);
  if (!Number.isFinite(date.getTime())) return null;
  return unixSeconds(date);
}

export type ReminderPingPlan = "present" | "schedule" | "skip";

/** Android 12 (API 31) introduced the user-toggleable exact-alarm app-op. */
export const EXACT_ALARM_API_LEVEL = 31;

/**
 * Whether to send the user to system exact-alarm settings.
 * `SCHEDULE_EXACT_ALARM` is an app-op, not a runtime permission, so JS cannot
 * read the toggle. Ask at most once and remember it in prefs.
 */
export function shouldOpenExactAlarmSettings(input: {
  os: string;
  apiLevel: number;
  alreadyAsked: boolean;
}): boolean {
  if (input.os !== "android") return false;
  if (!Number.isFinite(input.apiLevel) || input.apiLevel < EXACT_ALARM_API_LEVEL) return false;
  return !input.alreadyAsked;
}

/** Near-term DATE triggers are presented immediately — Android often drops them. */
export const REMINDER_PING_IMMINENT_SECONDS = 8;
/** Past DATE still sitting in the scheduler after this is treated as a missed fire. */
export const REMINDER_PING_STUCK_SECONDS = 60;
/** After this, a due reminder stays in the list but we do not re-banner it. */
export const REMINDER_PING_CATCHUP_SECONDS = 15 * 60;

/**
 * Decide whether to show, schedule, or leave an existing OS ping alone.
 * Reconcile used to cancel+reschedule every future DATE, which both missed
 * near-term fires and re-presented the banner after Open.
 */
export function reminderPingPlan(input: {
  remindAt: number;
  now: number;
  firedAt?: number | null;
  scheduledAt?: number | null;
  presented?: boolean;
}): ReminderPingPlan {
  const { remindAt, now, firedAt, scheduledAt, presented } = input;
  if (remindAt > now + REMINDER_PING_IMMINENT_SECONDS) {
    return scheduledAt === remindAt ? "skip" : "schedule";
  }
  if (firedAt === remindAt || presented) return "skip";
  if (scheduledAt === remindAt) {
    if (remindAt > now) return "skip";
    if (now - remindAt < REMINDER_PING_STUCK_SECONDS) return "skip";
    return "present";
  }
  if (remindAt <= now && now - remindAt > REMINDER_PING_CATCHUP_SECONDS) return "skip";
  return "present";
}

function asDataRecord(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function reminderPingPayload(data: unknown): ReminderPingPayload | null {
  const record = asDataRecord(data);
  const bookmarkId = record?.bookmarkId;
  if (typeof bookmarkId !== "string" || !bookmarkId) return null;
  const folderIdRaw = record.folderId;
  const folderId =
    folderIdRaw == null || folderIdRaw === "" || folderIdRaw === "null" ? null : String(folderIdRaw);
  return {
    bookmarkId,
    folderId,
    title: typeof record.title === "string" ? record.title : "",
    domain: typeof record.domain === "string" ? record.domain : "",
    description: typeof record.description === "string" ? record.description : "",
    remindAt: parseUnixSeconds(record.remindAt),
  };
}

/** Android sometimes delivers `dataString` instead of `data`; the request id is a last resort. */
export function reminderPingFromNotification(input: {
  identifier?: string;
  data?: unknown;
  dataString?: unknown;
}): ReminderPingPayload | null {
  const fromData = reminderPingPayload(input.data) ?? reminderPingPayload(input.dataString);
  if (fromData) return fromData;
  const bookmarkId = input.identifier ? bookmarkIdFromReminderIdentifier(input.identifier) : null;
  if (!bookmarkId) return null;
  return { bookmarkId, folderId: null, title: "", domain: "", description: "", remindAt: null };
}

export function bookmarkReminderStatus(
  remindAt: number | null | undefined,
  now = new Date(),
): ReminderStatus {
  return reminderStatus(remindAt, unixSeconds(now));
}

/** Next five-minute local step at or after `now`, used when Custom has no existing time. */
export function defaultCustomReminderAt(now = new Date()): number {
  return snapLocalMinutes(unixSeconds(now), 5);
}

export const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

/** Advance `unix` to the next `step`-minute local boundary (always in the future when leftover is 0). */
export function snapLocalMinutes(unix: number, step: number): number {
  const date = new Date(unix * 1000);
  date.setSeconds(0, 0);
  const leftover = date.getMinutes() % step;
  if (leftover !== 0) date.setMinutes(date.getMinutes() + (step - leftover));
  else date.setMinutes(date.getMinutes() + step);
  return unixSeconds(date);
}

export function applyLocalDate(unix: number, year: number, month: number, day: number): number {
  const date = new Date(unix * 1000);
  date.setFullYear(year, month, day);
  return unixSeconds(date);
}

export function applyLocalTime(unix: number, hour: number, minute: number): number {
  const date = new Date(unix * 1000);
  date.setHours(hour, minute, 0, 0);
  return unixSeconds(date);
}

export type DayPeriod = "am" | "pm";

export function localTimeParts(unix: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  hour12: number;
  period: DayPeriod;
} {
  const date = new Date(unix * 1000);
  const hour = date.getHours();
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hour,
    minute: date.getMinutes(),
    hour12: hour % 12 === 0 ? 12 : hour % 12,
    period: hour >= 12 ? "pm" : "am",
  };
}

export function hour12To24(hour12: number, period: DayPeriod): number {
  if (period === "am") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

export function formatMonthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Sunday-first narrow weekday labels in the device locale. */
export function weekdayNarrowLabels(): string[] {
  const sunday = new Date(2026, 8, 13);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + i);
    return date.toLocaleDateString(undefined, { weekday: "narrow" });
  });
}

export interface ReminderCalendarCell {
  key: string;
  day: number | null;
  year: number;
  month: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  selected: boolean;
}

/** Sunday-first month grid sized to whole weeks. */
export function reminderMonthGrid(
  year: number,
  month: number,
  selectedUnix: number,
  now = new Date(),
): ReminderCalendarCell[] {
  const selected = new Date(selectedUnix * 1000);
  const todayStart = startOfLocalDay(now).getTime();
  const startPad = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: ReminderCalendarCell[] = [];
  const total = startPad + daysInMonth;
  const weeks = Math.ceil(total / 7) * 7;
  for (let i = 0; i < weeks; i++) {
    const day = i - startPad + 1;
    if (day < 1 || day > daysInMonth) {
      cells.push({
        key: `e${i}`,
        day: null,
        year,
        month,
        inMonth: false,
        isToday: false,
        isPast: true,
        selected: false,
      });
      continue;
    }
    const start = startOfLocalDay(new Date(year, month, day)).getTime();
    cells.push({
      key: `${year}-${month}-${day}`,
      day,
      year,
      month,
      inMonth: true,
      isToday: start === todayStart,
      isPast: start < todayStart,
      selected:
        selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === day,
    });
  }
  return cells;
}

export function shiftCalendarMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function formatCustomDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
