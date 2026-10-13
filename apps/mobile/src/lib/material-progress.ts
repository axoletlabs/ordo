/** Pure, worklet-safe geometry shared by native and web Material indicators. */
export function boundedProgress(value: number): number {
  "worklet";
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function edge(time: number, delay: number, duration: number, outgoing: boolean): number {
  "worklet";
  const t = boundedProgress((time - delay) / duration);
  return outgoing ? t * t * t : 1 - Math.pow(1 - t, 3);
}

/** Two quick lines chase each other; both leave the track before looping. */
export function linearIndeterminateSegments(phase: number) {
  "worklet";
  const time = boundedProgress(phase) * 1800;
  return [
    { start: edge(time, 333, 1000, true), end: edge(time, 0, 1000, false) },
    { start: edge(time, 1267, 533, true), end: edge(time, 1000, 567, false) },
  ];
}

/** Four expand/contract cycles close at exactly four full turns (no jump). */
export function circularIndeterminateArc(phase: number) {
  "worklet";
  const cycle = boundedProgress(phase) * 4;
  const step = Math.floor(cycle);
  const t = cycle - step;
  const expand = t < 0.5;
  const ease = (1 - Math.cos(Math.PI * (expand ? t * 2 : (t - 0.5) * 2))) / 2;
  const sweep = expand ? 24 + 252 * ease : 276 - 252 * ease;
  const start = step * 252 + (expand ? 0 : 252 * ease) + cycle * 108;
  return { start, sweep };
}
