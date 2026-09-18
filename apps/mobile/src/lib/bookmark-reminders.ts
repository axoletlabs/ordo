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

export function reminderCompletedToast(): string {
  return "Reminder completed";
}

/** One hour out — the in-app "In 1 hour" preset. */
export function reminderLaterAt(now = new Date()): number {
  return reminderPresetAt("1h", now);
}

/** Small type chip so reminder pings stay distinct from other notifications. */
export const REMINDER_PING_SUBTITLE = "Reminder";

/**
 * Quiet OS copy: bookmark title, a Reminder subtitle (Android subText / iOS
 * subtitle), and the host when expanded. No instruction.
 */
export function reminderNotificationCopy(row: {
  title: string;
  domain?: string | null;
}): { title: string; subtitle: string; body?: string } {
  const title = row.title.trim() || "Saved page";
  const host = row.domain?.trim() ?? "";
  if (!host || host === title) return { title, subtitle: REMINDER_PING_SUBTITLE };
  return { title, subtitle: REMINDER_PING_SUBTITLE, body: host };
}

export const REMINDER_PING_CATEGORY = "ordo-reminder";
export const REMINDER_PING_OPEN = "open";
export const REMINDER_PING_COMPLETE = "complete";
/** @deprecated Old trays still send this; treated as Complete. */
export const REMINDER_PING_LATER = "later";
export const REMINDER_PING_RESCHEDULE = "reschedule";
/** Matches expo-notifications `DEFAULT_ACTION_IDENTIFIER`. */
export const REMINDER_PING_DEFAULT = "expo.modules.notifications.actions.DEFAULT";

export type ReminderPingKind = "open" | "complete" | "reschedule";

export type ReminderPingPayload = {
  bookmarkId: string;
  folderId: string | null;
  title: string;
  domain: string;
  remindAt: number | null;
};

export function reminderPingAction(actionIdentifier: string): ReminderPingKind | null {
  if (actionIdentifier === REMINDER_PING_COMPLETE || actionIdentifier === REMINDER_PING_LATER) {
    return "complete";
  }
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
  return parseUnixSeconds(record.value) ?? parseUnixSeconds(record.date) ?? parseUnixSeconds(record.timestamp);
}

export type ReminderPingPlan = "present" | "schedule" | "skip";

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
    remindAt: parseUnixSeconds(record.remindAt),
  };
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
