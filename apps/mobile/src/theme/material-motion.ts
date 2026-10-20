/** Material spring tokens. Damping = 2 × dampingRatio × sqrt(stiffness × mass). */
import { useReducedMotionPreference } from "../hooks/use-reduced-motion-preference";
import { useSettingsStore } from "../store/settings";

const spring = (stiffness: number, ratio: number) => ({
  stiffness,
  damping: 2 * ratio * Math.sqrt(stiffness),
  mass: 1,
});

export const materialMotion = {
  standard: {
    fast: spring(1400, 0.9),
    spatial: spring(700, 0.9),
    slow: spring(300, 0.9),
  },
  expressive: {
    fast: spring(800, 0.6),
    spatial: spring(380, 0.8),
    slow: spring(200, 0.8),
  },
  effects: { fast: spring(3800, 1), spatial: spring(1600, 1), slow: spring(800, 1) },
} as const;

// Motion is a shared value object, not render state. Stable identities let
// memoized control groups and labels reuse it when their parent re-renders.
// Keep both settings reactive, without allocating a wrapper for every caller.
const motionSchemes = [false, true].map((expressive) => [false, true].map((reducedMotion) =>
  Object.freeze({ ...materialMotion[expressive ? "expressive" : "standard"], expressive, reducedMotion }),
));

export function useMaterialMotion() {
  const expressive = useSettingsStore((s) => s.expressive);
  const reducedMotion = useReducedMotionPreference();
  return motionSchemes[Number(expressive)][Number(reducedMotion)];
}
