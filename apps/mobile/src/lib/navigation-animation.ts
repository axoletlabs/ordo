/**
 * Map the Appearance "Page animation" setting onto stack pushes and tab switches.
 */
import { Easing, Platform } from "react-native";
import type { NavigationAnimation } from "../store/settings";

export function stackScreenAnimation(preference: NavigationAnimation) {
  if (preference === "instant") return "none" as const;
  if (preference === "fade" || Platform.OS === "web") return "fade" as const;
  return "slide_from_right" as const;
}

export function screenAnimationDuration(preference: NavigationAnimation) {
  if (preference === "instant") return 0;
  if (preference === "fade") return 180;
  return 220;
}

/** Tabs can't push like a stack; Slide is the built-in lateral shift. */
export function tabScreenAnimation(preference: NavigationAnimation) {
  if (preference === "instant") return "none" as const;
  if (preference === "fade" || Platform.OS === "web") return "fade" as const;
  return "shift" as const;
}

export function tabTransitionSpec(preference: NavigationAnimation) {
  const duration = screenAnimationDuration(preference);
  return {
    animation: "timing" as const,
    config: {
      duration,
      easing: preference === "slide" ? Easing.inOut(Easing.ease) : Easing.in(Easing.linear),
    },
  };
}
