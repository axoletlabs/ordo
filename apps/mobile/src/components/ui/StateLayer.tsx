import React, { useEffect, useRef } from "react";
import { Animated, Platform, type StyleProp, type ViewStyle, StyleSheet } from "react-native";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { stateLayerCorners } from "../../theme/state-layer";

/** Lightweight, native-driver opacity; no per-row Reanimated color/layout work. */
export function useStateOpacity(target: number) {
  const { reducedMotion } = useMaterialMotion();
  const opacity = useRef(new Animated.Value(target)).current;
  const previous = useRef({ target, reducedMotion });
  useEffect(() => {
    if (previous.current.target === target && previous.current.reducedMotion === reducedMotion) return;
    previous.current = { target, reducedMotion };
    if (reducedMotion) { opacity.stopAnimation(); opacity.setValue(target); return; }
    const animation = Animated.spring(opacity, { toValue: target, ...materialMotion.effects.fast,
      useNativeDriver: Platform.OS !== "web", isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion, target]);
  return opacity;
}

export function StateLayer({ color, opacity: target, surfaceStyle, inset = 0, testID = "material-state-layer" }: {
  color: string; opacity: number; surfaceStyle?: StyleProp<ViewStyle>; inset?: number; testID?: string;
}) {
  const opacity = useStateOpacity(target);
  return <Animated.View testID={testID} pointerEvents="none" accessible={false}
    style={[{ position: "absolute", top: inset, bottom: inset, left: inset, right: inset }, stateLayerCorners(StyleSheet.flatten(surfaceStyle)),
      { overflow: "hidden", backgroundColor: color, opacity }]} />;
}
