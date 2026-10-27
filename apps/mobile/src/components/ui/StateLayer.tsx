import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Animated, Platform, type StyleProp, type ViewStyle, StyleSheet } from "react-native";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { alphaTint, opaqueComponents, stateLayerCorners } from "../../theme/state-layer";

/**
 * Visibility fade for state feedback. The alpha lives in the color, so the
 * element never rests at a sub-1 opacity (which distorts its radius clip).
 * Use a fixed JS driver when the view also has JS-driven animated styles:
 * making any part of its Animated graph native promotes the other values too.
 *
 * Layout timing: an immediate state handoff (e.g. a row palette flip when its
 * context menu opens) must be painted in the same frame. A passive effect
 * would leave one frame with the new palette and the old opacity — the tiny
 * color flash this guards against. Animation starts are equally safe here.
 */
export function useStateVisibility(active: boolean, useNativeDriver = Platform.OS !== "web", initialActive = active, immediate = false) {
  return useStateValue(Number(active), useNativeDriver, Number(initialActive), immediate);
}

/** Preserve spring velocity when feedback is interrupted or retargeted. */
function useStateValue(target: number, useNativeDriver: boolean, initial: number, immediate = false) {
  const { reducedMotion } = useMaterialMotion();
  const value = useRef(new Animated.Value(initial)).current;
  const previous = useRef({ target: initial, reducedMotion, immediate });
  useLayoutEffect(() => {
    if (previous.current.target === target && previous.current.reducedMotion === reducedMotion && previous.current.immediate === immediate) return;
    previous.current = { target, reducedMotion, immediate };
    if (reducedMotion || immediate) { value.stopAnimation(); value.setValue(target); return; }
    const animation = Animated.spring(value, { toValue: target, ...materialMotion.effects.fast,
      useNativeDriver, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [value, reducedMotion, target, useNativeDriver, immediate]);
  return value;
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
  const intensity = useStateValue(fraction, Platform.OS !== "web", 0);
  const paint = useMemo(() => opaqueComponents(color) ? {
    // Fade ink alpha, keeping the layer itself fully opaque so rounded clips
    // match their surface throughout hover, press, focus and release.
    backgroundColor: intensity.interpolate({ inputRange: [0, 1],
      outputRange: [alphaTint(color, 0), alphaTint(color, 1)], extrapolate: "clamp" }),
  } : { backgroundColor: color, opacity: intensity }, [color, intensity]);
  return <Animated.View testID={testID} pointerEvents="none" accessible={false}
    style={[{ position: "absolute", top: inset, bottom: inset, left: inset, right: inset },
      stateLayerCorners(StyleSheet.flatten(surfaceStyle)),
      { overflow: "hidden" }, paint]} />;
}
