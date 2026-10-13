/** Strict local-calendar parsing; Date's rollover must not accept February 31. */
export function parseCalendarInput(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3]);
  if (year < 1000 || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? { year, month, day } : null;
}

export function formatCalendarInput(unix: number): string {
  const date = new Date(unix * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
