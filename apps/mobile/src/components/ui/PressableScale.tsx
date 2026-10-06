/** Shared Material state layer and interruptible Expressive shape morph. */
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type AnimatedStyle } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { useButtonGroupInteraction } from "./ButtonGroup";
import { StateLayer } from "./StateLayer";
import { alphaTint, stateLayerCorners, stateLayerOpacity } from "../../theme/state-layer";
import { webSelectionKeys, type WebPressKeyEvent } from "./pressable-web";
import { nativeHoverEvents } from "../../lib/pointer-hover";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
type CornerShape = number | { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
function cornerValues(shape: CornerShape): number[] {
  return typeof shape === "number" ? [shape, shape, shape, shape] : [shape.topLeft, shape.topRight, shape.bottomLeft, shape.bottomRight];
}
export type PressableScaleProps = Omit<PressableProps, "style"> & {
  dataSet?: Record<string, string>;
  onKeyDown?: (event: WebPressKeyEvent) => void;
  scaleTo?: number;
  dim?: boolean;
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Explicit shape mapping prevents arbitrary components from morphing. */
  shape?: { rest: CornerShape; pressed: CornerShape };
  stateLayerColor?: string;
  /** Inset painted feedback when the visual (e.g. avatar) is smaller than its target. */
  stateLayerInset?: number;
  /** Menus should not retain a second mouse-focus highlight beside the hovered item. */
  focusOnlyVisible?: boolean;
  /** A caller supplies a Reanimated style (e.g. the collapsing FAB). */
  animated?: boolean;
};
export function PressableScale(props: PressableScaleProps) {
  const pressedCorners = props.shape ? cornerValues(props.shape.pressed) : [];
  const morphs = props.shape && cornerValues(props.shape.rest).some((value, index) => value !== pressedCorners[index]);
  return props.animated || morphs || (props.scaleTo != null && props.scaleTo !== 1) || props.dim
    ? <AnimatedStatePressable {...props} /> : <StatePressable {...props} />;
}

/** Ordinary actions need a state layer, not shared values and mount-time springs. */
function StatePressable({ style, children, disabled, stateLayerColor, stateLayerInset = 0, focusOnlyVisible = true,
  onPressIn, onPressOut, onHoverIn, onHoverOut, onFocus, onBlur,
  shape: _shape, scaleTo: _scaleTo, dim: _dim, animated: _animated, ...rest }: PressableScaleProps) {
  const { palette } = useTheme();
  const group = useButtonGroupInteraction();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const flat = StyleSheet.flatten(style as StyleProp<ViewStyle>);
  const tint = stateLayerColor ?? palette.onSurface;
  const focusLayer = focused && (!focusOnlyVisible || focusVisible || Platform.OS !== "web");
  return <Pressable {...rest} disabled={disabled}
    {...(Platform.OS === "web" ? { dataSet: { ...rest.dataSet, materialHoverSurface: "true" } } : {})}
    {...(Platform.OS === "web" ? webSelectionKeys({ ...rest, disabled }) : {})}
    {...(Platform.OS !== "web" ? nativeHoverEvents({ ...rest, disabled, onHoverIn, onHoverOut }, setHovered) : {})}
    aria-checked={rest.accessibilityState?.checked} aria-selected={rest.accessibilityState?.selected}
    aria-expanded={rest.accessibilityState?.expanded} aria-busy={rest.accessibilityState?.busy}
    aria-disabled={disabled || rest.accessibilityState?.disabled}
    // A transparent stateful drawable suppresses Android's stock rectangular
    // hover/focus highlight; the bounded Material layer below owns feedback.
    android_ripple={{ color: "transparent", borderless: false }}
    onPressIn={(event) => { group?.(true); onPressIn?.(event); }}
    onPressOut={(event) => { group?.(false); onPressOut?.(event); }}
    onHoverIn={(event) => { setHovered(true); onHoverIn?.(event); }}
    onHoverOut={(event) => { setHovered(false); onHoverOut?.(event); }}
    onFocus={(event) => { setFocused(true); setFocusVisible(Platform.OS === "web" && !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible")); onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); setFocusVisible(false); group?.(false); onBlur?.(event); }}
    style={[style as StyleProp<ViewStyle>, { position: flat?.position ?? "relative" },
      focusVisible && !disabled ? { outlineColor: palette.primary, outlineWidth: 3, outlineOffset: 2, outlineStyle: "solid" } : null]}>
    {(state) => <>{typeof children === "function" ? children(state) : children}
      <StateLayer color={tint} surfaceStyle={style as StyleProp<ViewStyle>} inset={stateLayerInset}
        fraction={stateLayerOpacity({ disabled, pressed: state.pressed, focused: focusLayer, hovered })} /></>}
  </Pressable>;
}

function AnimatedStatePressable({
  scaleTo = 1, dim = false, style, children, disabled, onPressIn, onPressOut,
  onHoverIn, onHoverOut, onFocus, onBlur, shape, stateLayerColor, stateLayerInset = 0, focusOnlyVisible = true, animated: _animated, ...rest
}: PressableScaleProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const groupInteraction = useButtonGroupInteraction();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const [down, setDown] = useState(false);
  const releaseFrame = useRef<number | null>(null);
  useEffect(() => () => { if (releaseFrame.current != null) cancelAnimationFrame(releaseFrame.current); }, []);
  const progress = useSharedValue(0);
  const layer = useSharedValue(0);
  const flat = StyleSheet.flatten(style as StyleProp<ViewStyle>);
  const background = useSharedValue(typeof flat?.backgroundColor === "string" ? flat.backgroundColor : "transparent");
  const backgroundColor = flat?.backgroundColor;
  const focusLayer = focused && (!focusOnlyVisible || Platform.OS !== "web" || focusVisible);
  const fraction = stateLayerOpacity({ disabled, pressed: down, focused: focusLayer, hovered });
  useEffect(() => {
    if (typeof backgroundColor !== "string") return;
    background.value = motion.reducedMotion ? backgroundColor : withSpring(backgroundColor, materialMotion.effects.fast);
  }, [background, backgroundColor, motion.reducedMotion]);
  const backgroundStyle = useAnimatedStyle(() => typeof backgroundColor === "string" ? { backgroundColor: background.value } : {});
  const restCorner = typeof flat?.borderRadius === "number" ? flat.borderRadius : 0;
  const restShape = cornerValues(shape?.rest ?? restCorner);
  const pressedShape = cornerValues(shape?.pressed ?? restCorner);
  const corners = useSharedValue(restShape);
  const cornerKey = [...restShape, ...pressedShape].join(":");

  useEffect(() => {
    progress.value = motion.reducedMotion ? (down ? 1 : 0) : withSpring(down ? 1 : 0, motion.fast);
    layer.value = motion.reducedMotion ? (fraction > 0 ? 1 : 0) : withSpring(fraction > 0 ? 1 : 0, motion.fast);
  }, [down, hovered, focused, focusVisible, focusOnlyVisible, disabled, progress, layer, motion.fast, motion.reducedMotion, fraction]);
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
      {...(Platform.OS === "web" ? { dataSet: { ...rest.dataSet, materialHoverSurface: "true" } } : {})}
      {...(Platform.OS === "web" ? webSelectionKeys({ ...rest, disabled }) : {})}
      {...(Platform.OS !== "web" ? nativeHoverEvents({ ...rest, disabled, onHoverIn, onHoverOut }, setHovered) : {})}
      aria-checked={rest.accessibilityState?.checked}
      aria-selected={rest.accessibilityState?.selected}
      aria-expanded={rest.accessibilityState?.expanded}
      aria-busy={rest.accessibilityState?.busy}
      aria-disabled={disabled || rest.accessibilityState?.disabled}
      disabled={disabled}
      android_ripple={{ color: "transparent", borderless: false }}
      onPressIn={(event) => { if (releaseFrame.current != null) cancelAnimationFrame(releaseFrame.current); setDown(true); groupInteraction?.(true); onPressIn?.(event); }}
      onPressOut={(event) => {
        // A toggle's onPress commits selection after press-out. Resolve both
        // together so its corners don't visit the old rest shape in between.
        if (releaseFrame.current != null) cancelAnimationFrame(releaseFrame.current);
        releaseFrame.current = requestAnimationFrame(() => { releaseFrame.current = null; setDown(false); });
        groupInteraction?.(false); onPressOut?.(event);
      }}
      onHoverIn={(event) => { setHovered(true); onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); onHoverOut?.(event); }}
      onFocus={(event) => {
        setFocused(true);
        setFocusVisible(Platform.OS === "web" && !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible"));
        onFocus?.(event);
      }}
      onBlur={(event) => { setFocused(false); setFocusVisible(false); setDown(false); groupInteraction?.(false); onBlur?.(event); }}
      style={[style, { position: flat?.position ?? "relative" }, Platform.OS === "web" && focusVisible && !disabled ? { outlineColor: palette.primary, outlineWidth: 3, outlineOffset: 2, outlineStyle: "solid" } : null, backgroundStyle, cornerStyle, feedback]}
    >
      {typeof children === "function" ? children({ pressed: down }) : children}
      <Animated.View testID="material-state-layer" pointerEvents="none" accessible={false} style={[{ position: "absolute", top: stateLayerInset, bottom: stateLayerInset, left: stateLayerInset, right: stateLayerInset }, stateLayerCorners(flat), {
        overflow: "hidden",
        backgroundColor: alphaTint(stateLayerColor ?? palette.onSurface, fraction),
      }, cornerStyle, layerStyle]} />
    </AnimatedPressable>
  );
}
