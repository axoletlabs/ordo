/**
 * React Native often delivers `onPress` after a long-press when the row
 * re-renders into selection mode under a still-down finger — especially if
 * the native host view is replaced. Ignore that release so the item that
 * entered selection stays selected.
 */
export type SelectionHoldSchedule = (cb: () => void) => void;

export function defaultSelectionHoldSchedule(cb: () => void) {
  requestAnimationFrame(() => {
    setTimeout(cb, 0);
  });
}

export function createSelectionHoldGuard(
  schedule: SelectionHoldSchedule = defaultSelectionHoldSchedule,
) {
  let suppress = false;
  let pointerDown = false;

  const clearIfUp = () => {
    if (!pointerDown) suppress = false;
  };

  return {
    pressIn() {
      pointerDown = true;
    },
    pressOut() {
      pointerDown = false;
      schedule(clearIfUp);
    },
    markEnter() {
      suppress = true;
      pointerDown = true;
    },
    /** True when this press belongs to the entering long-press. */
    consumePress() {
      if (!suppress) return false;
      pointerDown = false;
      schedule(clearIfUp);
      return true;
    },
    shouldIgnorePress() {
      return suppress;
    },
    reset() {
      suppress = false;
      pointerDown = false;
    },
  };
}
