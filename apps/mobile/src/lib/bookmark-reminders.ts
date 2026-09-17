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

export function bookmarkReminderStatus(
  remindAt: number | null | undefined,
  now = new Date(),
): ReminderStatus {
  return reminderStatus(remindAt, unixSeconds(now));
}

/** Next 5-minute local step at or after `now`, used when Custom has no existing time. */
export function defaultCustomReminderAt(now = new Date()): number {
  const rounded = new Date(now);
  rounded.setSeconds(0, 0);
  const leftover = rounded.getMinutes() % 5;
  if (leftover !== 0) rounded.setMinutes(rounded.getMinutes() + (5 - leftover));
  else rounded.setMinutes(rounded.getMinutes() + 5);
  return unixSeconds(rounded);
}

export function shiftLocalDays(unix: number, delta: number): number {
  const date = new Date(unix * 1000);
  date.setDate(date.getDate() + delta);
  return unixSeconds(date);
}

export function shiftLocalMinutes(unix: number, delta: number): number {
  return unixSeconds(unix * 1000 + delta * 60 * 1000);
}

export function formatCustomDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
