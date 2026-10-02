/** Shared Material state layer and interruptible Expressive shape morph. */
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { useButtonGroupInteraction } from "./ButtonGroup";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
type CornerShape = number | { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
function cornerValues(shape: CornerShape): number[] {
  return typeof shape === "number" ? [shape, shape, shape, shape] : [shape.topLeft, shape.topRight, shape.bottomLeft, shape.bottomRight];
}
export type PressableScaleProps = Omit<PressableProps, "style"> & {
  scaleTo?: number;
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Explicit shape mapping prevents arbitrary components from morphing. */
  shape?: { rest: CornerShape; pressed: CornerShape };
  stateLayerColor?: string;
};
export function PressableScale({
  scaleTo = 1, dim = false, style, children, disabled, onPressIn, onPressOut,
  onHoverIn, onHoverOut, onFocus, onBlur, shape, stateLayerColor, ...rest
}: PressableScaleProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const groupInteraction = useButtonGroupInteraction();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const [down, setDown] = useState(false);
  const progress = useSharedValue(0);
  const layer = useSharedValue(0);
  const flat = StyleSheet.flatten(style);
  const restCorner = typeof flat?.borderRadius === "number" ? flat.borderRadius : 0;
  const restShape = cornerValues(shape?.rest ?? restCorner);
  const pressedShape = cornerValues(shape?.pressed ?? restCorner);
  const corners = useSharedValue(restShape);
  const cornerKey = [...restShape, ...pressedShape].join(":");

  useEffect(() => {
    progress.value = motion.reducedMotion ? (down ? 1 : 0) : withSpring(down ? 1 : 0, motion.fast);
    const opacity = disabled ? 0 : down || focused ? 0.1 : hovered ? 0.08 : 0;
    layer.value = motion.reducedMotion ? opacity : withSpring(opacity, materialMotion.effects.fast);
  }, [down, hovered, focused, disabled, progress, layer, motion.fast, motion.reducedMotion]);
  useEffect(() => {
    const values = cornerKey.split(":").map(Number);
    const target = down && !disabled ? values.slice(4) : values.slice(0, 4);
    corners.value = motion.reducedMotion ? target : withSpring(target, motion.fast);
  }, [cornerKey, corners, down, disabled, motion.fast, motion.reducedMotion]);
  const cornerStyle = useAnimatedStyle(() => ({
    ...(shape ? { borderTopLeftRadius: Math.max(0, corners.value[0]!), borderTopRightRadius: Math.max(0, corners.value[1]!),
      borderBottomLeftRadius: Math.max(0, corners.value[2]!), borderBottomRightRadius: Math.max(0, corners.value[3]!) } : {}),
  }));
  const feedback = useAnimatedStyle(() => ({
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
      onPressIn={(event) => { setDown(true); groupInteraction?.(true); onPressIn?.(event); }}
      onPressOut={(event) => { setDown(false); groupInteraction?.(false); onPressOut?.(event); }}
      onHoverIn={(event) => { setHovered(true); onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); onHoverOut?.(event); }}
      onFocus={(event) => {
        setFocused(true);
        setFocusVisible(Platform.OS === "web" && !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible"));
        onFocus?.(event);
      }}
      onBlur={(event) => { setFocused(false); setFocusVisible(false); setDown(false); groupInteraction?.(false); onBlur?.(event); }}
      style={[style, { position: flat?.position ?? "relative" }, Platform.OS === "web" && focusVisible && !disabled ? { outlineColor: palette.primary, outlineWidth: 3, outlineOffset: 2, outlineStyle: "solid" } : null, cornerStyle, feedback]}
    >
      {typeof children === "function" ? children({ pressed: down }) : children}
      <Animated.View testID="material-state-layer" pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderRadius: restCorner,
        borderTopLeftRadius: flat?.borderTopLeftRadius ?? restCorner,
        borderTopRightRadius: flat?.borderTopRightRadius ?? restCorner,
        borderBottomLeftRadius: flat?.borderBottomLeftRadius ?? restCorner,
        borderBottomRightRadius: flat?.borderBottomRightRadius ?? restCorner,
        backgroundColor: stateLayerColor ?? palette.onSurface,
      }, cornerStyle, layerStyle]} />
    </AnimatedPressable>
  );
}
