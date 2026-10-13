/** Accept the first tap immediately; ignore a repeated handoff in the double-tap window. */
export function createLeadingTapGuard(windowMs = 500) {
  let lastKey: string | null = null;
  let lastTime = -Infinity;
  return (key: string, now = Date.now()) => {
    if (lastKey === key && now - lastTime < windowMs) return false;
    lastKey = key;
    lastTime = now;
    return true;
  };
}
