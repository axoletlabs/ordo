/** One interruptible disclosure gesture for settings and form dropdowns. */
import React, { useEffect, useRef } from "react";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useMaterialMotion } from "../../theme/material-motion";
import { MaterialIcon } from "./MaterialIcon";

type DisclosureChevronProps = { expanded: boolean; size?: number; color: string };

export function DisclosureChevron(props: DisclosureChevronProps) {
  const initialExpanded = useRef(props.expanded);
  const activated = useRef(props.expanded);
  if (props.expanded) activated.current = true;
  // Closed form fields must not initialize Reanimated graphs/subscriptions on
  // the cold-dialog path. Retain the graph after first opening for reversal.
  return activated.current ? <AnimatedDisclosureChevron {...props} initialExpanded={initialExpanded.current} />
    : <MaterialIcon testID="material-disclosure-chevron" pointerEvents="none" name="chevron-down" size={props.size} color={props.color} />;
}

function AnimatedDisclosureChevron({ expanded, initialExpanded, size = 24, color }: DisclosureChevronProps & { initialExpanded: boolean }) {
  const motion = useMaterialMotion();
  const progress = useSharedValue(Number(initialExpanded));
  const previous = useRef({ expanded: initialExpanded, reducedMotion: motion.reducedMotion });
  useEffect(() => {
    if (previous.current.expanded === expanded && previous.current.reducedMotion === motion.reducedMotion) return;
    previous.current = { expanded, reducedMotion: motion.reducedMotion };
    progress.value = motion.reducedMotion ? Number(expanded) : withSpring(Number(expanded), motion.fast);
  }, [expanded, motion.reducedMotion, motion.fast, progress]);
  useEffect(() => () => cancelAnimation(progress), [progress]);
  const rotation = useAnimatedStyle(() => ({ transform: [{ rotate: `${(motion.reducedMotion ? Number(expanded) : progress.value) * 180}deg` }] }));
  return <Animated.View testID="material-disclosure-chevron" pointerEvents="none" accessible={false}
    style={[{ width: size, height: size, flexShrink: 0 }, rotation]}>
    <MaterialIcon name="chevron-down" size={size} color={color} />
  </Animated.View>;
}
