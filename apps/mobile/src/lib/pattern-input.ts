/** Shared by gesture and accessible button entry; Android skip-fill is unchanged. */
export function appendPatternNode(current: readonly number[], node: number): number[] {
  if (!Number.isInteger(node) || node < 0 || node > 8 || current.includes(node)) return [...current];
  const next = [...current];
  const from = current.at(-1);
  if (from != null) {
    const dr = Math.floor(node / 3) - Math.floor(from / 3), dc = node % 3 - from % 3;
    let x = Math.abs(dr), y = Math.abs(dc);
    while (y) { const t = y; y = x % y; x = t; }
    const steps = x || 1;
    for (let i = 1; i < steps; i++) {
      const mid = (Math.floor(from / 3) + dr / steps * i) * 3 + from % 3 + dc / steps * i;
      if (!next.includes(mid)) next.push(mid);
    }
  }
  next.push(node);
  return next;
}
