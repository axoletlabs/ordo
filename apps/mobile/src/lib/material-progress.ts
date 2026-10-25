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

export type ProgressSegment = { start: number; end: number };

/** Complement of the active spans, leaving a visible 4dp gap at rounded caps. */
export function linearTrackSegments(segments: ProgressSegment[], width: number, gap = 4): ProgressSegment[] {
  "worklet";
  const active = segments.filter(({ start, end }) => end > start)
    .map(({ start, end }) => ({ start: Math.max(0, start - gap), end: Math.min(width, end + gap) }))
    .sort((a, b) => a.start - b.start);
  const track: ProgressSegment[] = [];
  let cursor = 0;
  for (const segment of active) {
    if (segment.start > cursor) track.push({ start: cursor, end: segment.start });
    cursor = Math.max(cursor, segment.end);
  }
  if (cursor < width) track.push({ start: cursor, end: width });
  return track;
}

/** Coordinates describe the outside of the rounded caps, not their centers. */
export function straightProgressPath(start: number, end: number, center = 2): string {
  "worklet";
  if (end - start < 4) return "";
  return `M${start + 2},${center} L${end - 2},${center}`;
}

/** A 40dp circular indicator, with an optional ten-lobed wave on the active arc.
 * The track stays circular, as in Material's circular wavy indicator. */
export function circularProgressPaths(start: number, sweep: number, wavy: boolean) {
  "worklet";
  const radius = 16;
  const amplitude = wavy ? 1.5 : 0;
  const gap = 4 / radius; // 4dp clear space, plus each rounded cap's 2dp.
  const cap = 2 / radius;
  const radians = Math.PI / 180;
  const from = start * radians;
  const span = Math.max(0, Math.min(360, sweep)) * radians;

  const arc = (begin: number, end: number, wave: number) => {
    // Cubic Hermite interpolation preserves smooth caps and wave tangents.
    const point = (angle: number) => {
      const r = radius + wave * Math.sin((angle - from) * 10);
      const dr = wave * 10 * Math.cos((angle - from) * 10);
      return { x: 20 + r * Math.cos(angle), y: 20 + r * Math.sin(angle),
        dx: dr * Math.cos(angle) - r * Math.sin(angle),
        dy: dr * Math.sin(angle) + r * Math.cos(angle) };
    };
    if (end <= begin) return "";
    let angle = begin;
    let previous = point(angle);
    let path = `M${previous.x},${previous.y}`;
    while (angle < end) {
      const next = Math.min(end, angle + Math.PI / 40);
      const current = point(next);
      const third = (next - angle) / 3;
      path += ` C${previous.x + previous.dx * third},${previous.y + previous.dy * third},${current.x - current.dx * third},${current.y - current.dy * third},${current.x},${current.y}`;
      angle = next;
      previous = current;
    }
    return path;
  };

  return {
    indicator: span > 0 ? arc(from + cap, from + Math.max(cap, span - cap), amplitude) : "",
    track: span >= 2 * Math.PI ? "" : arc(from + span + cap + gap, from + 2 * Math.PI - cap - gap, 0),
  };
}
