/**
 * Pure page-animation policy. Kept free of React Native so node:test can
 * cover which transition picks up a new page-animation setting.
 */
import type { NavigationAnimation } from "../store/settings";

/** True when the focused expo-router path is the tab navigator, not a pushed stack screen. */
export function isTabNavigatorFocused(segments: readonly string[]) {
  return segments.includes("(tabs)");
}

/**
 * Stack pushes and the trip back use the current preference. Holding the
 * previous type through the pop made that one travel play the old animation.
 */
export function resolveStackNavigationAnimation(preference: NavigationAnimation): NavigationAnimation {
  return preference;
}

/**
 * Don't rewrite frozen tab scenes while a stack screen is still presented.
 * Applying fade/instant there leaves translateX on the tab underneath.
 * The new tab animation starts once the tabs are focused again.
 */
export function resolveAppliedNavigationAnimation(
  preference: NavigationAnimation,
  tabNavigatorFocused: boolean,
  held: NavigationAnimation,
): NavigationAnimation {
  return tabNavigatorFocused ? preference : held;
}

export function shouldDetachInactiveTabScenes(
  preference: NavigationAnimation,
  flushingInactive: boolean,
) {
  return preference === "instant" || flushingInactive;
}
