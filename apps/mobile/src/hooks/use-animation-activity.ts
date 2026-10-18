/** One foreground subscription for every repeating animation, including web. */
import { createContext, useContext, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

export const AnimationActivityContext = createContext(true);
const listeners = new Set<() => void>();
let release: (() => void) | undefined;
function foreground() {
  return Platform.OS === "web" && typeof document !== "undefined"
    ? document.visibilityState !== "hidden"
    : AppState.currentState !== "background" && AppState.currentState !== "inactive";
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const notify = () => listeners.forEach((callback) => callback());
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", notify);
      release = () => document.removeEventListener("visibilitychange", notify);
    } else {
      const subscription = AppState.addEventListener("change", notify);
      release = () => subscription.remove();
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { release?.(); release = undefined; }
  };
}
export function useAppForeground() {
  return useSyncExternalStore(subscribe, foreground, () => true);
}
export function useAnimationActivity() {
  const active = useContext(AnimationActivityContext);
  return useAppForeground() && active;
}
