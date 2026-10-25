import React from "react";
import { Platform } from "react-native";
import { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMaterialMotion } from "../theme/material-motion";

/** Menu-style fade-through inside one persistent dialog surface. Retain the
 * committed page until it is invisible; never superimpose two sets of text. */
export function useOverlayPage<T>(visible: boolean, pageKey: string, value: T) {
  const motion = useMaterialMotion();
  const progress = useSharedValue(1);
  const leaving = useSharedValue(0);
  const [outgoing, setOutgoing] = React.useState<{ value: T } | null>(null);
  const [commit, setCommit] = React.useState(0);
  const committed = React.useRef({ visible, pageKey, value });
  const target = React.useRef({ visible, pageKey, token: 0 });

  if (visible && committed.current.visible && committed.current.pageKey !== pageKey && !outgoing && !motion.reducedMotion) {
    setOutgoing({ value: committed.current.value });
  }
  if (visible && !committed.current.visible && outgoing) setOutgoing(null);
  const content = outgoing ? outgoing.value : value;
  React.useLayoutEffect(() => {
    committed.current = { visible, pageKey, value: content };
  }, [visible, pageKey, content]);

  const swap = React.useCallback((token: number) => {
    if (!target.current.visible || token !== target.current.token) return;
    leaving.value = 0;
    setOutgoing(null);
    setCommit((value) => value + 1);
  }, [leaving]);

  React.useLayoutEffect(() => {
    if (!commit || !visible || outgoing) return;
    // React must commit the incoming controls before their fade begins.
    progress.value = motion.reducedMotion ? 1 : withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
  }, [commit, visible, outgoing, progress, motion.reducedMotion]);

  React.useLayoutEffect(() => {
    const previous = target.current;
    const token = previous.token + 1;
    if (!visible || !previous.visible || motion.reducedMotion) {
      target.current = { visible, pageKey, token };
      cancelAnimation(progress);
      leaving.value = 0;
      progress.value = 1;
      setOutgoing(null);
      return;
    }
    if (previous.pageKey === pageKey) return;
    target.current = { visible, pageKey, token };
    leaving.value = 1;
    progress.value = withTiming(0, { duration: 100, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) runOnJS(swap)(token);
    });
  }, [visible, pageKey, motion.reducedMotion, progress, leaving, swap]);

  React.useLayoutEffect(() => () => {
    target.current.token += 1;
    cancelAnimation(progress);
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    ...(Platform.OS !== "web" ? { transform: [{ translateX: (leaving.value ? -8 : 8) * (1 - progress.value) }] } : {}),
  }));
  return { content, style, leaving: outgoing !== null };
}
