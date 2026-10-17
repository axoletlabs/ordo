/** Material clock geometry. One continuous target, not a button per numeral. */
export const CLOCK_SIZE = 256;
export const CLOCK_CENTER = CLOCK_SIZE / 2;
export const CLOCK_OUTER_RADIUS = 104;
export const CLOCK_INNER_RADIUS = 68;
export type ClockField = "hour" | "minute";

export function clockPoint(value: number, divisions: number, inner = false) {
  const angle = value / divisions * Math.PI * 2;
  const radius = inner ? CLOCK_INNER_RADIUS : CLOCK_OUTER_RADIUS;
  return { x: CLOCK_CENTER + Math.sin(angle) * radius, y: CLOCK_CENTER - Math.cos(angle) * radius };
}

/** Ignore the ambiguous center. Taps snap to five minutes; dragging can be precise. */
export function clockValueAt(x: number, y: number, field: ClockField, hour12: boolean, minuteStep: 1 | 5 = 5): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const dx = x - CLOCK_CENTER, dy = y - CLOCK_CENTER;
  const radius = Math.hypot(dx, dy);
  if (radius < 24) return null;
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
  const index = Math.round(turn * 12) % 12;
  if (field === "minute") {
    const divisions = 60 / minuteStep;
    return Math.round(turn * divisions) % divisions * minuteStep;
  }
  if (hour12) return index || 12;
  const inner = radius < (CLOCK_INNER_RADIUS + CLOCK_OUTER_RADIUS) / 2;
  return inner ? index === 0 ? 0 : index + 12 : index || 12;
}

export function stepClockValue(value: number, step: number, field: ClockField, hour12: boolean) {
  const min = field === "hour" && hour12 ? 1 : 0;
  const count = field === "minute" ? 60 : hour12 ? 12 : 24;
  return ((value - min + step) % count + count) % count + min;
}
