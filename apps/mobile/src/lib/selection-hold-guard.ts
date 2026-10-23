/**
 * React Native often delivers `onPress` after a long-press when the row
 * re-renders into selection mode under a still-down finger — especially if
 * the native host view is replaced. Web can deliver the synthesized click
 * hundreds of milliseconds after `pointerup` (double-tap detection), so a
 * frame/timer cleanup races the click and lets it open the row. Keep the
 * suppression until the release press is consumed or the next press starts;
 * it never expires by time while that release may still arrive.
 */
export function createSelectionHoldGuard() {
  let suppress = false;
  let pressed = false;

  return {
    pressIn() {
      // A new gesture is a fresh decision. A re-render can re-deliver press-in
      // during the same hold; only a genuinely new press (after release)
      // clears suppression.
      if (!pressed) suppress = false;
      pressed = true;
    },
    pressOut() {
      pressed = false;
      // Keep `suppress` through release: the matching onPress can be delivered
      // a frame or several hundred milliseconds later on web.
    },
    markEnter() {
      suppress = true;
      pressed = true;
    },
    /** True when this press belongs to the entering long-press. */
    consumePress() {
      if (!suppress) return false;
      suppress = false;
      pressed = false;
      return true;
    },
    shouldIgnorePress() {
      return suppress;
    },
    reset() {
      suppress = false;
      pressed = false;
    },
  };
}
