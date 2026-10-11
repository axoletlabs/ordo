/** Reanimated's hook is an initial snapshot; this shared subscription stays live. */
import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

const listeners = new Set<() => void>();
let nativeValue: boolean | undefined;
let cleanup: (() => void) | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const notify = () => listeners.forEach((callback) => callback());
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", notify);
      cleanup = () => query.removeEventListener("change", notify);
    } else if (Platform.OS !== "web") {
      const update = (value: boolean) => { nativeValue = value; notify(); };
      const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", update);
      void AccessibilityInfo.isReduceMotionEnabled().then(update, () => {});
      cleanup = () => subscription.remove();
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { cleanup?.(); cleanup = undefined; }
  };
}

export function useReducedMotionPreference() {
  const initial = useReducedMotion();
  return useSyncExternalStore(subscribe, () => Platform.OS === "web" && typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : nativeValue ?? initial, () => initial);
}
