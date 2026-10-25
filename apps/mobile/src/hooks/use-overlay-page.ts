import React from "react";
import { Platform } from "react-native";
import { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMaterialMotion } from "../theme/material-motion";

/** Commit the incoming page immediately so measurement and the surface's size
 * spring start together. A short reveal softens the replacement without a
 * fade-out timer/JS handoff delaying layout or committing an obsolete page.
 * The owning overlay still retains its committed contents during dismissal. */
export function useOverlayPage<T>(visible: boolean, pageKey: string, value: T) {
  const { reducedMotion } = useMaterialMotion();
  const progress = useSharedValue(1);
  const committed = React.useRef({ visible, pageKey });

  React.useLayoutEffect(() => {
    const previous = committed.current;
    committed.current = { visible, pageKey };
    cancelAnimation(progress);
    if (!visible || !previous.visible || reducedMotion) {
      progress.value = 1;
      return;
    }
    if (previous.pageKey !== pageKey) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
    }
  }, [visible, pageKey, reducedMotion, progress]);

  React.useLayoutEffect(() => () => cancelAnimation(progress), [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    ...(Platform.OS !== "web" ? { transform: [{ translateY: 4 * (1 - progress.value) }] } : {}),
  }));
  // There is no retained outgoing page to disable; incoming controls are live.
  return { content: value, style, leaving: false };
}
