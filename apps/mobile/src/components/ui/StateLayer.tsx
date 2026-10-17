import React, { useEffect, useRef } from "react";
import { Animated, Platform, type StyleProp, type ViewStyle, StyleSheet } from "react-native";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { alphaTint, stateLayerCorners } from "../../theme/state-layer";

/**
 * Visibility fade for state feedback. The alpha lives in the color, so the
 * element never rests at a sub-1 opacity (which distorts its radius clip).
 * Use a fixed JS driver when the view also has JS-driven animated styles:
 * making any part of its Animated graph native promotes the other values too.
 */
export function useStateVisibility(active: boolean, useNativeDriver = Platform.OS !== "web", initialActive = active, immediate = false) {
  const { reducedMotion } = useMaterialMotion();
  const opacity = useRef(new Animated.Value(initialActive ? 1 : 0)).current;
  const previous = useRef({ active: initialActive, reducedMotion, immediate });
  useEffect(() => {
    if (previous.current.active === active && previous.current.reducedMotion === reducedMotion && previous.current.immediate === immediate) return;
    previous.current = { active, reducedMotion, immediate };
    if (reducedMotion || immediate) { opacity.stopAnimation(); opacity.setValue(active ? 1 : 0); return; }
    const animation = Animated.spring(opacity, { toValue: active ? 1 : 0, ...materialMotion.effects.fast,
      useNativeDriver, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion, active, useNativeDriver, immediate]);
  return opacity;
}

type StateLayerProps = {
  color: string; fraction: number; surfaceStyle?: StyleProp<ViewStyle>; inset?: number; testID?: string;
};

export function StateLayer(props: StateLayerProps) {
  // An untouched action has no ink to paint. Avoid allocating animation values,
  // motion subscriptions and an invisible view for every date in a picker.
  // Retain after the first interaction so release still gets its full fade.
  const activated = useRef(props.fraction > 0);
  if (props.fraction > 0) activated.current = true;
  return activated.current ? <ActiveStateLayer {...props} /> : null;
}

function ActiveStateLayer({ color, fraction, surfaceStyle, inset = 0, testID = "material-state-layer" }: StateLayerProps) {
  // Start the first on-demand layer transparent, retaining the same entrance
  // spring as an already-mounted layer (or settling immediately if reduced).
  const opacity = useStateVisibility(fraction > 0, Platform.OS !== "web", false);
  // Keep ink through exit. Clearing its alpha on release used to make the
  // fade animate an already-invisible layer (a one-frame feedback blink).
  const ink = useRef(fraction);
  if (fraction > 0) ink.current = fraction;
  return <Animated.View testID={testID} pointerEvents="none" accessible={false}
    style={[{ position: "absolute", top: inset, bottom: inset, left: inset, right: inset },
      stateLayerCorners(StyleSheet.flatten(surfaceStyle)),
      { overflow: "hidden", backgroundColor: alphaTint(color, ink.current), opacity }]} />;
}
