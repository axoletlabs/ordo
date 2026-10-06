import React, { useEffect, useRef } from "react";
import { Animated, Platform, type StyleProp, type ViewStyle, StyleSheet } from "react-native";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { alphaTint, stateLayerCorners } from "../../theme/state-layer";

/**
 * Visibility fade for state feedback. The alpha lives in the color, so the
 * element never rests at a sub-1 opacity (which distorts its radius clip).
 */
export function useStateVisibility(active: boolean) {
  const { reducedMotion } = useMaterialMotion();
  const opacity = useRef(new Animated.Value(active ? 1 : 0)).current;
  const previous = useRef({ active, reducedMotion });
  useEffect(() => {
    if (previous.current.active === active && previous.current.reducedMotion === reducedMotion) return;
    previous.current = { active, reducedMotion };
    if (reducedMotion) { opacity.stopAnimation(); opacity.setValue(active ? 1 : 0); return; }
    const animation = Animated.spring(opacity, { toValue: active ? 1 : 0, ...materialMotion.effects.fast,
      useNativeDriver: Platform.OS !== "web", isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion, active]);
  return opacity;
}

export function StateLayer({ color, fraction, surfaceStyle, inset = 0, testID = "material-state-layer" }: {
  color: string; fraction: number; surfaceStyle?: StyleProp<ViewStyle>; inset?: number; testID?: string;
}) {
  const opacity = useStateVisibility(fraction > 0);
  return <Animated.View testID={testID} pointerEvents="none" accessible={false}
    style={[{ position: "absolute", top: inset, bottom: inset, left: inset, right: inset },
      stateLayerCorners(StyleSheet.flatten(surfaceStyle)),
      { overflow: "hidden", backgroundColor: alphaTint(color, fraction), opacity }]} />;
}
