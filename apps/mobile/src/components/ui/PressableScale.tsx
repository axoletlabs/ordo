/** Shared Material state layer and interruptible Expressive shape morph. */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export type PressableScaleProps = Omit<PressableProps, "style"> & {
  scaleTo?: number;
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Explicit shape mapping prevents arbitrary components from morphing. */
  shape?: { rest: number; pressed: number };
  stateLayerColor?: string;
};
export function PressableScale({
  scaleTo = 1, dim = false, style, children, disabled, onPressIn, onPressOut,
  onHoverIn, onHoverOut, onFocus, onBlur, shape, stateLayerColor, ...rest
}: PressableScaleProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [down, setDown] = useState(false);
  const progress = useSharedValue(0);
  const layer = useSharedValue(0);
  const flat = StyleSheet.flatten(style);
  const restCorner = shape?.rest ?? (typeof flat?.borderRadius === "number" ? flat.borderRadius : 0);
  const pressedCorner = shape?.pressed ?? restCorner;

  useEffect(() => {
    progress.value = motion.reducedMotion ? (down ? 1 : 0) : withSpring(down ? 1 : 0, motion.fast);
    layer.value = withTiming(disabled ? 0 : down || focused ? 0.12 : hovered ? 0.08 : 0, { duration: motion.reducedMotion ? 0 : 150 });
  }, [down, hovered, focused, disabled, progress, layer, motion.fast, motion.reducedMotion]);
  const feedback = useAnimatedStyle(() => ({
    ...(shape ? { borderRadius: restCorner + (pressedCorner - restCorner) * Math.max(0, Math.min(1, progress.value)) } : {}),
    transform: [{ scale: motion.reducedMotion ? 1 : 1 + (scaleTo - 1) * progress.value }],
    opacity: dim ? 1 - Math.max(0, Math.min(1, progress.value)) * 0.12 : flat?.opacity ?? 1,
  }));
  const layerStyle = useAnimatedStyle(() => ({ opacity: layer.value }));
  return (
    <AnimatedPressable
      {...rest}
      aria-checked={rest.accessibilityState?.checked}
      aria-selected={rest.accessibilityState?.selected}
      aria-expanded={rest.accessibilityState?.expanded}
      aria-busy={rest.accessibilityState?.busy}
      aria-disabled={disabled || rest.accessibilityState?.disabled}
      disabled={disabled}
      onPressIn={(event) => { setDown(true); onPressIn?.(event); }}
      onPressOut={(event) => { setDown(false); onPressOut?.(event); }}
      onHoverIn={(event) => { setHovered(true); onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); onHoverOut?.(event); }}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); setDown(false); onBlur?.(event); }}
      style={[style, { position: flat?.position ?? "relative" }, focused && !disabled ? { outlineColor: palette.primary, outlineWidth: 3, outlineOffset: 2 } : null, feedback]}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: restCorner, overflow: "hidden" }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: stateLayerColor ?? palette.onSurface }, layerStyle]} />
      </View>
      {typeof children === "function" ? children({ pressed: down }) : children}
    </AnimatedPressable>
  );
}
