/**
 * Apply the page-animation setting without rewriting an in-flight transition.
 */
import React from "react";
import { useSegments } from "expo-router";
import {
  isTabNavigatorFocused,
  resolveAppliedNavigationAnimation,
  shouldDetachInactiveTabScenes,
} from "../lib/navigation-animation-policy";
import { useSettingsStore, type NavigationAnimation } from "../store/settings";

export function useAppliedNavigationAnimation() {
  const preference = useSettingsStore((s) => s.navigationAnimation);
  const segments = useSegments();
  const tabNavigatorFocused = isTabNavigatorFocused(segments);
  const [held, setHeld] = React.useState(preference);

  if (tabNavigatorFocused && held !== preference) {
    setHeld(preference);
  }

  return resolveAppliedNavigationAnimation(preference, tabNavigatorFocused, held);
}

/** One frame of detach so frozen tab scenes remount without leftover shift. */
export function useDetachInactiveTabScenes(preference: NavigationAnimation) {
  const previous = React.useRef(preference);
  const [flushingInactive, setFlushingInactive] = React.useState(false);

  if (previous.current !== preference) {
    previous.current = preference;
    setFlushingInactive(true);
  }

  React.useEffect(() => {
    if (!flushingInactive) return;
    setFlushingInactive(false);
  }, [flushingInactive]);

  return shouldDetachInactiveTabScenes(preference, flushingInactive);
}
