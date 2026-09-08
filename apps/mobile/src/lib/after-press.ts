/**
 * Let the press-out spring start a frame before heavy work (navigation, sheets).
 * Two rAFs: one to paint the in-state, one to start the out-state, then commit.
 */
export function afterPress(fn: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}
