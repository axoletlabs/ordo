/** Strict numeric time entry, preserving invalid drafts until corrected. */
export function parseTimeInput(hour: string, minute: string, hour12: boolean, period: "am" | "pm") {
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const h = Number(hour), m = Number(minute);
  if (m > 59 || h > (hour12 ? 12 : 23) || h < (hour12 ? 1 : 0)) return null;
  return { hour: hour12 ? h % 12 + (period === "pm" ? 12 : 0) : h, minute: m };
}

export function localeUses12HourTime() {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 === true;
}
