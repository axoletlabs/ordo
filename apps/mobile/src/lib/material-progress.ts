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

/** Cubic Hermite sine wave: 4dp stroke, 3dp amplitude, 40/20dp wavelength. */
export function wavyProgressPath(start: number, end: number, width: number, phase: number, amplitude: number, wavelength: number): string {
  "worklet";
  const left = Math.max(2, start + 2);
  const right = Math.min(width - 2, end - 2);
  if (right <= left) return "";
  const frequency = 2 * Math.PI / wavelength;
  let x = left;
  let angle = (x / wavelength + phase) * 2 * Math.PI;
  let y = 5 + amplitude * Math.sin(angle);
  let path = `M${x},${y}`;
  while (x < right) {
    const next = Math.min(right, x + wavelength / 4);
    const nextAngle = (next / wavelength + phase) * 2 * Math.PI;
    const nextY = 5 + amplitude * Math.sin(nextAngle);
    const third = (next - x) / 3;
    path += ` C${x + third},${y + third * amplitude * frequency * Math.cos(angle)},${next - third},${nextY - third * amplitude * frequency * Math.cos(nextAngle)},${next},${nextY}`;
    x = next;
    angle = nextAngle;
    y = nextY;
  }
  return path;
}
