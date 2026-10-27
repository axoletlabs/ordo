import React, { useLayoutEffect, useRef, useState } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSurfaceSize } from "../../hooks/use-surface-size";
import { ResizeOwnerContext } from "./resize-owner";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";

/** Keep closing content painted until its height/fade settles. Collapsed
 * content is inert immediately, and mounts lazily on its first expansion.
 * Inside a resizing surface, commit intrinsic layout and let the surface
 * own the height animation. `contentHeight` skips measurement when the height is statically known —
 * virtualized children and late-mounted subtrees must not wait on an
 * onLayout that arrives late (or never) on native. */
export function AnimatedDisclosure({ expanded, children, style, contentHeight }: {
  expanded: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; contentHeight?: number;
}) {
  const [activated, setActivated] = useState(expanded);
  if (expanded && !activated) setActivated(true);
  return activated ? <DisclosureSurface expanded={expanded} style={style} contentHeight={contentHeight}>{children}</DisclosureSurface> : null;
}

function DisclosureSurface({ expanded, children, style, contentHeight }: {
  expanded: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; contentHeight?: number;
}) {
  const motion = useMaterialMotion();
  const owned = React.useContext(ResizeOwnerContext);
  const [measured, setMeasured] = useState(0);
  const height = contentHeight ?? measured;
  const opacity = useSharedValue(0);
  const size = useSurfaceSize(owned ? null : expanded ? height : 0, { initialHeight: 0 });
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
    style={[style, { overflow: "hidden", flexShrink: owned ? 1 : 0 }, owned ? { height: expanded ? undefined : 0 } : size, fade]}>
    <ResizeOwnerContext.Provider value>
    <View collapsable={false} style={{ flexShrink: owned ? 1 : 0 }} onLayout={contentHeight != null ? undefined : (event) => {
      const next = event.nativeEvent.layout.height;
      setMeasured(current => Math.abs(current - next) < 0.5 ? current : next);
    }}>{expanded ? children : retained.current}</View>
    </ResizeOwnerContext.Provider>
  </Animated.View>;
}
