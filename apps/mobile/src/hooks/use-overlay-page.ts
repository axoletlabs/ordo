import React from "react";
import { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { materialMotion, useMaterialMotion } from "../theme/material-motion";

/** Fade through one committed page at a time. Keep the outgoing layout while
 * it fades, then let incoming measurement, the surface's spatial spring, and
 * the effects spring run together. Never blank or translate a live page on tap. */
export function useOverlayPage<T>(visible: boolean, pageKey: string, value: T) {
  const { reducedMotion } = useMaterialMotion();
  const progress = useSharedValue(1);
  const [outgoing, setOutgoing] = React.useState<{ key: string; value: T } | null>(null);
  const [revision, setRevision] = React.useState(0);
  const committed = React.useRef({ visible, pageKey, value });
  const target = React.useRef({ visible, pageKey, generation: 0 });

  if (visible && committed.current.visible && committed.current.pageKey !== pageKey && !outgoing && !reducedMotion) {
    setOutgoing({ key: committed.current.pageKey, value: committed.current.value });
  }
  const content = outgoing ? outgoing.value : value;
  const contentKey = outgoing ? outgoing.key : pageKey;
  React.useLayoutEffect(() => {
    committed.current = { visible, pageKey, value: content };
  }, [visible, pageKey, content]);

  const swap = React.useCallback((generation: number) => {
    if (!target.current.visible || target.current.generation !== generation) return;
    setOutgoing(null);
    setRevision(current => current + 1);
  }, []);

  React.useLayoutEffect(() => {
    if (!revision || !visible || outgoing || reducedMotion) return;
    progress.value = withSpring(1, materialMotion.effects.slow);
  }, [revision, visible, outgoing, reducedMotion, progress]);

  React.useLayoutEffect(() => {
    const previous = target.current;
    if (!visible || !previous.visible || reducedMotion) {
      target.current = { visible, pageKey, generation: previous.generation + 1 };
      cancelAnimation(progress);
      // Freeze the current fade through dismissal; reopening and reduced
      // motion start fully painted beneath the owning surface's entrance.
      if (visible) progress.value = 1;
      setOutgoing(null);
      return;
    }
    if (previous.pageKey === pageKey) return;
    const generation = previous.generation + 1;
    target.current = { visible, pageKey, generation };
    progress.value = withTiming(0, { duration: 80, easing: Easing.in(Easing.quad) }, finished => {
      if (finished) runOnJS(swap)(generation);
    });
  }, [visible, pageKey, reducedMotion, progress, swap]);

  React.useLayoutEffect(() => () => {
    target.current.generation += 1;
    cancelAnimation(progress);
  }, [progress]);
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  return { content, contentKey, style, leaving: outgoing !== null };
}
