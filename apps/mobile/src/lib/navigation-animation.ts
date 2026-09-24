/**
 * Map the Appearance "Page animation" setting onto stack pushes and tab switches.
 *
 * Changing the tab animation type while a slide/shift is frozen leaves
 * translateX on those scenes. Tab switches wait until the tabs are focused
 * again. Stack pushes and pops follow the current preference, including the
 * trip back after you change it. Fade keeps a 0px translateX so a leftover
 * shift can clear.
 *
 * Scene interpolators come from expo-router, not `@react-navigation/*` — SDK 56
 * fails the OTA Metro bundle on those imports.
 */
import { SceneStyleInterpolators } from "expo-router/tabs";
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

/**
 * Fade normally drops transform, so a leftover shift translateX stays on the
 * native view. Drive translateX to 0 on the same animated node instead.
 */
function forFadeClearingShift(
  props: Parameters<typeof SceneStyleInterpolators.forFade>[0],
) {
  const faded = SceneStyleInterpolators.forFade(props);
  return {
    sceneStyle: {
      ...faded.sceneStyle,
      transform: [
        {
          translateX: props.current.progress.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [0, 0, 0],
          }),
        },
      ],
    },
  };
}

export function tabSceneStyleInterpolator(preference: NavigationAnimation) {
  if (tabScreenAnimation(preference) !== "fade") return undefined;
  return forFadeClearingShift;
}
