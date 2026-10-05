/** A right-anchored toolbar; the final action never drifts during resizing. */
export function selectionActionLayout(keys: readonly string[], width: number, pressedKey: string | null = null,
  expand = false, gap = 8) {
  const base = Math.max(48, (width - gap * Math.max(0, keys.length - 1)) / Math.max(1, keys.length));
  const pressed = pressedKey == null ? -1 : keys.indexOf(pressedKey);
  const growth = expand && pressed >= 0 && keys.length > 1 ? base * 0.15 : 0;
  const neighbors = pressed === 0 || pressed === keys.length - 1 ? 1 : 2;
  let right = 0;
  const layout: Record<string, { right: number; width: number }> = {};
  for (let index = keys.length - 1; index >= 0; index--) {
    const size = base + (index === pressed ? growth : Math.abs(index - pressed) === 1 ? -growth / neighbors : 0);
    layout[keys[index]!] = { right, width: size };
    right += size + gap;
  }
  return layout;
}
