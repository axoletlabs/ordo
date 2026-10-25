import React, { useLayoutEffect, useRef, useState } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSurfaceSize } from "../../hooks/use-surface-size";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";

/** Keep closing content painted until its height/fade settles. Collapsed
 * content is inert immediately, and mounts lazily on its first expansion. */
export function AnimatedDisclosure({ expanded, children, style }: {
  expanded: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const [activated, setActivated] = useState(expanded);
  if (expanded && !activated) setActivated(true);
  return activated ? <DisclosureSurface expanded={expanded} style={style}>{children}</DisclosureSurface> : null;
}

function DisclosureSurface({ expanded, children, style }: {
  expanded: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const motion = useMaterialMotion();
  const [height, setHeight] = useState(0);
  const opacity = useSharedValue(0);
  const size = useSurfaceSize(expanded ? height : 0, { initialHeight: 0 });
  const retained = useRef(children);
  const ref = useRef<View>(null);
  useLayoutEffect(() => { if (expanded) retained.current = children; }, [children, expanded]);
  useLayoutEffect(() => {
    opacity.value = motion.reducedMotion ? Number(expanded) : withSpring(Number(expanded), materialMotion.effects.spatial);
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = !expanded;
  }, [expanded, motion.reducedMotion, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View ref={ref} testID="material-disclosure" pointerEvents={expanded ? "auto" : "none"}
    aria-hidden={!expanded} accessibilityElementsHidden={!expanded}
    importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
    style={[style, { overflow: "hidden", flexShrink: 0 }, size, fade]}>
    <View collapsable={false} style={{ flexShrink: 0 }} onLayout={(event) => {
      const next = event.nativeEvent.layout.height;
      setHeight(current => Math.abs(current - next) < 0.5 ? current : next);
    }}>{expanded ? children : retained.current}</View>
  </Animated.View>;
}
