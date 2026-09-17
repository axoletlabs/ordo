/** Unix time in seconds. Matches Prisma `Int` so reminders stay a single integer. */
export const UNIX_SECONDS_MIN = 0;
export const UNIX_SECONDS_MAX = 2_147_483_647;

export type ReminderStatus = "none" | "upcoming" | "due";
export type ReminderFilter = "all" | "due" | "upcoming";

/** Floor a Date or epoch-ms value to unix seconds. */
export function unixSeconds(at: Date | number = Date.now()): number {
  const ms = typeof at === "number" ? at : at.getTime();
  return Math.floor(ms / 1000);
}

export function isUnixSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= UNIX_SECONDS_MIN &&
    value <= UNIX_SECONDS_MAX
  );
}

export function reminderStatus(
  remindAt: number | null | undefined,
  nowSec = unixSeconds(),
): ReminderStatus {
  if (remindAt == null) return "none";
  return remindAt <= nowSec ? "due" : "upcoming";
}

export function isReminderDue(
  remindAt: number | null | undefined,
  nowSec = unixSeconds(),
): boolean {
  return reminderStatus(remindAt, nowSec) === "due";
}

export function parseReminderFilter(value: unknown): Exclude<ReminderFilter, "all"> | undefined {
  return value === "due" || value === "upcoming" ? value : undefined;
}
