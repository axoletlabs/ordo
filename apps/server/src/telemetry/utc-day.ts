/** UTC calendar helpers for install telemetry. Days are `YYYY-MM-DD`. */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
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
