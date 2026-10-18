/** Yield a paint before optional content work, then use spare JS time rather
 * than a fixed 16ms timer that competes with scrolling and native layout. */
export function scheduleIdleWork(work: () => void): () => void {
  let cancelled = false;
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    if (cancelled) return;
    const run = () => { if (!cancelled) work(); };
    if (typeof requestIdleCallback === "function") idle = requestIdleCallback(run);
    else timer = setTimeout(run, 32);
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    if (idle !== undefined) cancelIdleCallback(idle);
    if (timer !== undefined) clearTimeout(timer);
  };
}
