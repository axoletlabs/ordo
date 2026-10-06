/**
 * Map the Appearance "Page animation" setting onto stack pushes.
 *
 * Stack pushes and pops follow the current preference, including the
 * trip back after you change it.
 *
 * Scene interpolators come from expo-router, not `@react-navigation/*` — SDK 56
 * fails the OTA Metro bundle on those imports.
 */
import { Platform } from "react-native";
import type { NavigationAnimation } from "../store/settings";

export function stackScreenAnimation(preference: NavigationAnimation) {
  if (preference === "instant") return "none" as const;
  if (preference === "fade" || Platform.OS === "web") return "fade" as const;
  return "slide_from_right" as const;
}

export function screenAnimationDuration(preference: NavigationAnimation) {
  if (preference === "instant") return 0;
  if (preference === "fade") return 200;
  return 300;
}

