/** One foreground subscription for every repeating animation, including web. */
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

/** Legacy boolean scope. Layer owners still publish their covered/active state
 * here, and page trees still inherit it without subscribing to host activity. */
export const AnimationActivityContext = createContext(true);

/** Stable host-background activity scope. The provider value never changes, so
 * opening a blocking overlay updates only the leaf hooks that actually animate
 * instead of reconciling the whole background tree through a context value. */
export type AnimationActivityScope = {
  getSnapshot: () => boolean;
  subscribe: (listener: () => void) => () => void;
  setActive: (active: boolean) => void;
};

export const AnimationActivityScopeContext = createContext<AnimationActivityScope | null>(null);

export function createAnimationActivityScope(initial = true): AnimationActivityScope {
  let active = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => active,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const NO_SUBSCRIBE = () => () => {};
const ALWAYS_ACTIVE = () => true;

const foregroundListeners = new Set<() => void>();
let releaseForeground: (() => void) | undefined;
function foreground() {
  return Platform.OS === "web" && typeof document !== "undefined"
    ? document.visibilityState !== "hidden"
    : AppState.currentState !== "background" && AppState.currentState !== "inactive";
}
function subscribeForeground(listener: () => void) {
  foregroundListeners.add(listener);
  if (foregroundListeners.size === 1) {
    const notify = () => foregroundListeners.forEach((callback) => callback());
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", notify);
      releaseForeground = () => document.removeEventListener("visibilitychange", notify);
    } else {
      const subscription = AppState.addEventListener("change", notify);
      releaseForeground = () => subscription.remove();
    }
  }
  return () => {
    foregroundListeners.delete(listener);
    if (!foregroundListeners.size) { releaseForeground?.(); releaseForeground = undefined; }
  };
}
export function useAppForeground() {
  return useSyncExternalStore(subscribeForeground, foreground, () => true);
}
export function useAnimationActivity() {
  const legacyActive = useContext(AnimationActivityContext);
  const scope = useContext(AnimationActivityScopeContext);
  const scopedActive = useSyncExternalStore(
    scope ? scope.subscribe : NO_SUBSCRIBE,
    scope ? scope.getSnapshot : ALWAYS_ACTIVE,
    scope ? scope.getSnapshot : ALWAYS_ACTIVE,
  );
  return useAppForeground() && legacyActive && scopedActive;
}

/** Effect-only activity subscription for work that pauses/resumes but never
 * changes rendered output. Unlike the render hook, this does not re-render on
 * scope/foreground transitions. The callback must be stable (useCallback with
 * its true dependencies); its cleanup runs synchronously on pause, scope
 * replacement, foreground loss and unmount. */
export function useAnimationActivityEffect(
  effect: (active: boolean) => void | (() => void),
) {
  const legacyActive = useContext(AnimationActivityContext);
  const scope = useContext(AnimationActivityScopeContext);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let pending = false;
    let last: boolean | null = null;
    let cleanup: void | (() => void);

    const combined = () => legacyActive && (scope ? scope.getSnapshot() : true) && foreground();

    const cancel = () => {
      const previous = cleanup;
      cleanup = undefined;
      if (typeof previous === "function") previous();
    };

    const reconcile = () => {
      if (disposed) return;
      if (running) { pending = true; return; }
      running = true;
      try {
        do {
          pending = false;
          const next = combined();
          if (next === last) continue;
          last = next;
          cancel();
          const result = effect(next);
          if (disposed) {
            if (typeof result === "function") result();
            return;
          }
          cleanup = result;
        } while (pending);
      } finally {
        running = false;
      }
    };

    // Subscribe before reading the snapshot. Any synchronous notification that
    // arrives during subscription reconciles against the latest snapshot; the
    // initial reconcile below then sees the same value and does not duplicate.
    const unsubscribeScope = scope?.subscribe(reconcile);
    const unsubscribeForeground = subscribeForeground(reconcile);
    reconcile();

    return () => {
      disposed = true;
      unsubscribeScope?.();
      unsubscribeForeground();
      cancel();
    };
  }, [legacyActive, scope, effect]);
}
