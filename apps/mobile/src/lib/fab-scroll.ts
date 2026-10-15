export interface FabScrollState { previous: number; origin: number; direction: number; collapsed: boolean }

export function stepFabScrollState(state: FabScrollState, offset: number, threshold: number): FabScrollState {
  "worklet";
  const next = Math.max(0, offset);
  if (next <= 8) return { previous: next, origin: next, direction: 0, collapsed: false };
  const delta = next - state.previous;
  if (Math.abs(delta) < 1) return state;
  const sign = Math.sign(delta);
  const origin = sign !== state.direction ? state.previous : state.origin;
  return { previous: next, origin, direction: sign,
    collapsed: Math.abs(next - origin) >= threshold ? sign > 0 : state.collapsed };
}

/** Direction hysteresis prevents a FAB from expanding/collapsing on tiny scroll jitter. */
export function createFabScrollState(threshold = 24) {
  let state: FabScrollState = { previous: 0, origin: 0, direction: 0, collapsed: false };
  const next = (offset: number) => {
    state = stepFabScrollState(state, offset, threshold);
    return state.collapsed;
  };
  return Object.assign(next, {
    /** Re-sync after programmatic scrolling so stale deltas don't flip state. */
    reset(at = 0) {
      state = { previous: Math.max(0, at), origin: Math.max(0, at), direction: 0, collapsed: false };
    },
  });
}
