/** Direction hysteresis prevents a FAB from expanding/collapsing on tiny scroll jitter. */
export function createFabScrollState(threshold = 24) {
  let previous = 0;
  let origin = 0;
  let direction = 0;
  let collapsed = false;
  return (offset: number) => {
    const next = Math.max(0, offset);
    if (next <= 8) { previous = origin = next; direction = 0; collapsed = false; return collapsed; }
    const delta = next - previous;
    if (Math.abs(delta) < 1) return collapsed;
    const sign = Math.sign(delta);
    if (sign !== direction) { direction = sign; origin = previous; }
    if (Math.abs(next - origin) >= threshold) collapsed = sign > 0;
    previous = next;
    return collapsed;
  };
}
