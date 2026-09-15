/**
 * Pure page-animation policy. Kept free of React Native so node:test can
 * cover the "don't rewrite an in-flight slide" rules.
 */
import type { NavigationAnimation } from "../store/settings";

/** True when the focused expo-router path is the tab navigator, not a pushed stack screen. */
export function isTabNavigatorFocused(segments: readonly string[]) {
  return segments.includes("(tabs)");
}

/**
 * Keep the animation that started the current stack push until that screen
 * pops. Applying fade/instant on the still-presented screen is what leaves
 * the tab scene shifted.
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
