/** Scroll paint stays on the UI thread; JS receives bounded bookkeeping plus
 * exact drag/momentum endpoints. Reset safely after a clock adjustment. */
export function shouldReportScroll(now: number, previous?: number): boolean {
  "worklet";
  return previous == null || now < previous || now - previous >= 80;
}
