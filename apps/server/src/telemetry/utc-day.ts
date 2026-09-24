/** UTC calendar helpers for install telemetry. Days are `YYYY-MM-DD`. */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC calendar day for a unix timestamp in seconds. */
export function utcDayFromUnix(ts: number): string {
  return utcDay(new Date(ts * 1000));
}

export function dayStartUtc(day: string): Date {
  const match = day.match(DAY_RE);
  if (!match) throw new Error(`Invalid telemetry day '${day}'`);
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
}

export function addUtcDays(day: string, delta: number): string {
  const start = dayStartUtc(day);
  return utcDay(new Date(start.getTime() + delta * 24 * 60 * 60 * 1000));
}

export function eachUtcDay(from: string, to: string): string[] {
  if (from > to) return [];
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addUtcDays(cursor, 1);
    if (days.length > 400) break;
  }
  return days;
}

export function asCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}
