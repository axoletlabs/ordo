/** Material spring tokens. Damping = 2 × dampingRatio × sqrt(stiffness × mass). */
import { useReducedMotion } from "react-native-reanimated";
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
  effects: { fast: spring(1600, 1), spatial: spring(380, 1), slow: spring(200, 1) },
} as const;

export function useMaterialMotion() {
  const expressive = useSettingsStore((s) => s.expressive);
  const reducedMotion = useReducedMotion();
  return { ...materialMotion[expressive ? "expressive" : "standard"], expressive, reducedMotion };
}
