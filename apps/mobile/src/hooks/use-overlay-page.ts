import React from "react";
import { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { useMaterialMotion } from "../theme/material-motion";

/** Commit incoming content immediately for measurement. Its reveal waits for
 * that page's layout, then gives the size spring a short head start. Only
 * opacity changes: a second spatial motion fights the resizing surface. */
export function useOverlayPage<T>(visible: boolean, pageKey: string, value: T, ready = true) {
  const { reducedMotion } = useMaterialMotion();
  const progress = useSharedValue(1);
  const committed = React.useRef({ visible, pageKey });
  const pending = React.useRef(false);

  React.useLayoutEffect(() => {
    const previous = committed.current;
    committed.current = { visible, pageKey };
    if (!visible || !previous.visible || reducedMotion) {
      cancelAnimation(progress);
      pending.current = false;
      progress.value = 1;
      return;
    }
    if (previous.pageKey !== pageKey) {
      cancelAnimation(progress);
      pending.current = true;
      progress.value = 0;
    }
    if (pending.current && ready) {
      pending.current = false;
      progress.value = withDelay(40, withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }));
    }
  }, [visible, pageKey, ready, reducedMotion, progress]);

  React.useLayoutEffect(() => () => cancelAnimation(progress), [progress]);
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  return { content: value, style, leaving: false };
}
