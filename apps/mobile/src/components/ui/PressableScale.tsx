/** Shared Material state layer and interruptible Expressive shape morph. */
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type AnimatedStyle } from "react-native-reanimated";
import { Pressable as GesturePressable } from "react-native-gesture-handler";
import { useTheme } from "../../theme/ThemeProvider";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { useButtonGroupInteraction } from "./ButtonGroup";
import { StateLayer } from "./StateLayer";
import { alphaTint, opaqueComponents, stateLayerCorners, stateLayerOpacity } from "../../theme/state-layer";
import { webSelectionKeys, type WebPressKeyEvent } from "./pressable-web";
import { nativeHoverEvents } from "../../lib/pointer-hover";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// Native-driven transforms aren't represented in Fabric's touch shadow tree.
// Opt in only for controls whose handlers don't need RN's synthetic event API.
const NativeGesturePressable = GesturePressable as unknown as typeof Pressable;
const AnimatedGesturePressable = Animated.createAnimatedComponent(NativeGesturePressable);
type CornerShape = number | { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
function cornerValues(shape: CornerShape): number[] {
  return typeof shape === "number" ? [shape, shape, shape, shape] : [shape.topLeft, shape.topRight, shape.bottomLeft, shape.bottomRight];
}
export type PressableSurfaceState = {
  children: React.ReactNode;
  backgroundStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  cornerStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Animated fill for the state layer's painted parts. Applied to every part
   * (not as an overlay opacity) so the feedback never rests or transitions at
   * a sub-1 element opacity, which rasterizers composite as a group whose
   * radius clips and edges stop matching the surface beneath. */
  stateLayerStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Shared Material ink, including the state fraction. Used when a surface
   * paints the layer statically (no animated fill available). */
  stateLayerColor: string;
};
export type PressableScaleProps = Omit<PressableProps, "style"> & {
  dataSet?: Record<string, string>;
  onKeyDown?: (event: WebPressKeyEvent) => void;
  scaleTo?: number;
  dim?: boolean;
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Paint a smaller control inside its real (not hitSlop-only) interaction target. */
  visualStyle?: StyleProp<ViewStyle>;
  /** Explicit shape mapping prevents arbitrary components from morphing. */
  shape?: { rest: CornerShape; pressed: CornerShape };
  stateLayerColor?: string;
  /** Inset painted feedback when the visual (e.g. avatar) is smaller than its target. */
  stateLayerInset?: number;
  /** Menus should not retain a second mouse-focus highlight beside the hovered item. */
  focusOnlyVisible?: boolean;
  /** A caller supplies a Reanimated style (e.g. the collapsing FAB). */
  animated?: boolean;
  /** Custom painted geometry; interaction, shape and state feedback stay shared. */
  renderSurface?: (state: PressableSurfaceState) => React.ReactNode;
  /** Hit-test a native-transformed action against its real platform view. */
  nativeGesture?: boolean;
  /** Reuse an enclosing group's motion subscription (internal to shared controls). */
  motion?: ReturnType<typeof useMaterialMotion>;
};
export function PressableScale(props: PressableScaleProps) {
  // Shape-aware controls keep one tree across Standard/Expressive changes.
  // Switching implementations would remount focused/pressed controls mid-gesture.
  if (props.animated || (props.scaleTo != null && props.scaleTo !== 1) || props.dim) {
    return <AnimatedStatePressable {...props} />;
  }
  // A shaped control that never scales or dims does not need the transform
  // progress shared value or its animated style. Standard and Expressive both
  // resolve to the same wrapper, so a mode switch never remounts the pressable.
  if (props.shape) return props.motion ? <ProvidedShapePressable {...props} /> : <ShapePressable {...props} />;
  return <StatePressable {...props} />;
}

/** Ordinary actions need a state layer, not shared values and mount-time springs. */
function StatePressable({ style, visualStyle, children, disabled, stateLayerColor, stateLayerInset = 0, focusOnlyVisible = true, renderSurface, nativeGesture,
  onPressIn, onPressOut, onHoverIn, onHoverOut, onFocus, onBlur,
  shape: _shape, scaleTo: _scaleTo, dim: _dim, animated: _animated, motion: _motion, ...rest }: PressableScaleProps) {
  const { palette } = useTheme();
  const group = useButtonGroupInteraction();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const flat = StyleSheet.flatten(style as StyleProp<ViewStyle>);
  const tint = stateLayerColor ?? palette.onSurface;
  const focusLayer = focused && (!focusOnlyVisible || focusVisible || Platform.OS !== "web");
  const ActionPressable = nativeGesture && Platform.OS !== "web" ? NativeGesturePressable : Pressable;
  return <ActionPressable {...rest} disabled={disabled}
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
    style={[style as StyleProp<ViewStyle>, renderSurface ? { backgroundColor: "transparent" } : null, { position: flat?.position ?? "relative" },
      focusVisible && !disabled ? { outlineColor: palette.primary, outlineWidth: 3, outlineOffset: 2, outlineStyle: "solid" } : null]}>
    {(state) => {
      const content = typeof children === "function" ? children(state) : children;
      if (renderSurface) return renderSurface({ children: content,
        backgroundStyle: { backgroundColor: flat?.backgroundColor }, cornerStyle: stateLayerCorners(flat),
        stateLayerColor: alphaTint(tint, stateLayerOpacity({ disabled, pressed: state.pressed, focused: focusLayer, hovered })) });
      const contents = <>{content}
        <StateLayer color={tint} surfaceStyle={visualStyle ?? style as StyleProp<ViewStyle>} inset={stateLayerInset}
          fraction={stateLayerOpacity({ disabled, pressed: state.pressed, focused: focusLayer, hovered })} /></>;
      return visualStyle ? <View pointerEvents="box-none" style={visualStyle}>{contents}</View> : contents;
    }}
  </ActionPressable>;
}

type MotionScheme = ReturnType<typeof useMaterialMotion>;
type TransformState = {
  pressed: boolean;
  reducedMotion: boolean;
  spring: MotionScheme["fast"];
  scaleTo: number;
  dim: boolean;
  opacity: number | undefined;
};
type TransformFeedback = (state: TransformState) => StyleProp<AnimatedStyle<ViewStyle>> | undefined;

/** Shaped controls that never scale or dim keep the no-op strategy so the
 * surface core can call one transform hook unconditionally. This strategy
 * intentionally allocates nothing. */
function useStaticTransform(_state: TransformState): undefined { return undefined; }

/** The only transform strategy that owns animation state. */
function useTransformFeedback({ pressed, reducedMotion, spring, scaleTo, dim, opacity }: TransformState) {
  const progress = useSharedValue(0);
  const previous = useRef({ pressed: false, reducedMotion });
  useEffect(() => {
    if (previous.current.pressed === pressed && previous.current.reducedMotion === reducedMotion) return;
    previous.current = { pressed, reducedMotion };
    progress.value = reducedMotion ? Number(pressed) : withSpring(Number(pressed), spring);
  }, [pressed, reducedMotion, spring, progress]);
  return useAnimatedStyle(() => ({
    transform: [{ scale: reducedMotion ? 1 : 1 + (scaleTo - 1) * progress.value }],
    opacity: dim ? 1 - Math.max(0, Math.min(1, progress.value)) * 0.12 : opacity ?? 1,
  }));
}

/** Own the motion subscription when no enclosing group already has one. */
function ShapePressable(props: PressableScaleProps) {
  const motion = useMaterialMotion();
  return <ControlSurface {...props} motion={motion} useTransform={useStaticTransform} />;
}

/** Grouped controls (Segmented) pass their single motion subscription down. */
function ProvidedShapePressable({ motion, ...props }: PressableScaleProps) {
  return <ControlSurface {...props} motion={motion as MotionScheme} useTransform={useStaticTransform} />;
}

function AnimatedStatePressable(props: PressableScaleProps) {
  const motion = useMaterialMotion();
  return <ControlSurface {...props} motion={motion} useTransform={useTransformFeedback} />;
}

/** One interaction/paint core for every shaped control. The wrapper picks a
 * fixed transform strategy for its lifetime; switching between a static and a
 * scaling control changes the wrapper type (an expected remount), so the
 * strategy hook order can never change while a surface is mounted. */
function ControlSurface({
  scaleTo = 1, dim = false, style, visualStyle, children, disabled, onPressIn, onPressOut,
  onHoverIn, onHoverOut, onFocus, onBlur, shape, stateLayerColor, stateLayerInset = 0,
  focusOnlyVisible = true, renderSurface, nativeGesture, motion, useTransform,
  animated: _animated, ...rest
}: PressableScaleProps & { motion: MotionScheme; useTransform: TransformFeedback }) {
  const { palette } = useTheme();
  const groupInteraction = useButtonGroupInteraction();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const [down, setDown] = useState(false);
  const releaseFrame = useRef<number | null>(null);
  useEffect(() => () => { if (releaseFrame.current != null) cancelAnimationFrame(releaseFrame.current); }, []);
  const layer = useSharedValue(0);
  // One flatten feeds both the resting paint and the corners; only a visual
  // inset needs the untouched style too.
  const flat = StyleSheet.flatten(visualStyle ?? style as StyleProp<ViewStyle>);
  const targetStyle = visualStyle ? StyleSheet.flatten(style as StyleProp<ViewStyle>) : flat;
  const transformStyle = useTransform({
    pressed: down && !disabled,
    reducedMotion: motion.reducedMotion,
    spring: motion.fast,
    scaleTo,
    dim,
    opacity: typeof flat?.opacity === "number" ? flat.opacity : undefined,
  });
  const background = useSharedValue(typeof flat?.backgroundColor === "string" ? flat.backgroundColor : "transparent");
  const backgroundColor = flat?.backgroundColor;
  const previousBackground = useRef({ color: backgroundColor, reducedMotion: motion.reducedMotion });
  const focusLayer = focused && (!focusOnlyVisible || Platform.OS !== "web" || focusVisible);
  const fraction = stateLayerOpacity({ disabled, pressed: down, focused: focusLayer, hovered });
  const ink = useRef(fraction);
  if (fraction > 0) ink.current = fraction;
  const tint = stateLayerColor ?? palette.onSurface;
  const tintRgb = opaqueComponents(tint);
  const focusRing = Platform.OS === "web" && focusVisible && !disabled;
  // On a painted sub-surface the outer hit target is larger than (and often
  // squarer than) the pill. Draw the web focus indicator on the painted shape
  // instead, using its on-colour so it stays visible over filled buttons.
  const focusRingColor = stateLayerColor && stateLayerColor !== "transparent" ? stateLayerColor : palette.primary;
  const visualFocusRing = focusRing && visualStyle
    ? { outlineColor: focusRingColor, outlineWidth: 3, outlineOffset: -3, outlineStyle: "solid" as const } : null;
  const outerFocusStyle = focusRing ? (visualStyle ? { outlineStyle: "none" as const }
    : { outlineColor: palette.primary, outlineWidth: 3, outlineOffset: 2, outlineStyle: "solid" as const }) : null;
  // Captured per render: useAnimatedStyle refreshes its closure, so fraction
  // changes (hover -> press) reach the worklet without a shared-value read.
  // The ref's retained ink keeps a release fade at the last visible fraction.
  const inkFraction = ink.current;
  useEffect(() => {
    if (typeof backgroundColor !== "string") return;
    if (previousBackground.current.color === backgroundColor && previousBackground.current.reducedMotion === motion.reducedMotion) return;
    previousBackground.current = { color: backgroundColor, reducedMotion: motion.reducedMotion };
    background.value = motion.reducedMotion ? backgroundColor : withSpring(backgroundColor, materialMotion.effects.fast);
  }, [background, backgroundColor, motion]);
  const backgroundStyle = useAnimatedStyle(() => typeof backgroundColor === "string" ? { backgroundColor: background.value } : {});
  const restCorner = typeof flat?.borderRadius === "number" ? flat.borderRadius : 0;
  const restShape = cornerValues(shape?.rest ?? restCorner);
  const pressedShape = cornerValues(shape?.pressed ?? restCorner);
  const corners = useSharedValue(restShape);
  const cornerKey = [...restShape, ...pressedShape].join(":");
  // Shared values already contain the resting paint. Starting springs per
  // untouched control on mount stalls dense pickers before their first frame.
  // Compare targets, not .value (a synchronous UI-thread read on native).
  const previousFeedback = useRef({ active: false, reducedMotion: motion.reducedMotion });
  const previousCorners = useRef({ target: restShape.join(":"), reducedMotion: motion.reducedMotion });

  useEffect(() => {
    const active = fraction > 0;
    const previous = previousFeedback.current;
    if (previous.active !== active || previous.reducedMotion !== motion.reducedMotion) {
      layer.value = motion.reducedMotion ? Number(active) : withSpring(Number(active), materialMotion.effects.fast);
    }
    previousFeedback.current = { active, reducedMotion: motion.reducedMotion };
  }, [layer, motion, fraction]);
  useEffect(() => {
    const values = cornerKey.split(":").map(Number);
    const target = down && !disabled ? values.slice(4) : values.slice(0, 4);
    const key = target.join(":");
    if (previousCorners.current.target === key && previousCorners.current.reducedMotion === motion.reducedMotion) return;
    previousCorners.current = { target: key, reducedMotion: motion.reducedMotion };
    corners.value = motion.reducedMotion ? target : withSpring(target, motion.fast);
  }, [cornerKey, corners, down, disabled, motion]);
  const cornerStyle = useAnimatedStyle(() => ({
    ...(shape ? { borderTopLeftRadius: Math.max(0, corners.value[0]!), borderTopRightRadius: Math.max(0, corners.value[1]!),
      borderBottomLeftRadius: Math.max(0, corners.value[2]!), borderBottomRightRadius: Math.max(0, corners.value[3]!) } : {}),
  }));
  const layerStyle = useAnimatedStyle(() => {
    if (!tintRgb) return { opacity: layer.value };
    // The fade lives in the color: a sub-1 ELEMENT opacity makes the
    // compositor rasterize the layer and its radius clips as a group that
    // stops matching the surface beneath it (squared-off caps, edge slivers).
    const alpha = Math.max(0, Math.min(1, layer.value * inkFraction));
    return { backgroundColor: `rgba(${tintRgb[0]},${tintRgb[1]},${tintRgb[2]},${alpha})` };
  });
  const content = typeof children === "function" ? children({ pressed: down }) : children;
  const contents = renderSurface ? renderSurface({ children: content, backgroundStyle, cornerStyle,
    stateLayerStyle: layerStyle, stateLayerColor: alphaTint(tint, ink.current) }) : <>
    {content}
    <Animated.View testID="material-state-layer" pointerEvents="none" accessible={false} style={[{ position: "absolute", top: stateLayerInset, bottom: stateLayerInset, left: stateLayerInset, right: stateLayerInset }, stateLayerCorners(flat), {
      overflow: "hidden", backgroundColor: tintRgb ? "transparent" : alphaTint(tint, ink.current),
    }, cornerStyle, layerStyle]} />
  </>;
  const ActionPressable = nativeGesture && Platform.OS !== "web" ? AnimatedGesturePressable : AnimatedPressable;
  return (
    <ActionPressable
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
      onBlur={(event) => { if (releaseFrame.current != null) cancelAnimationFrame(releaseFrame.current); releaseFrame.current = null;
        setFocused(false); setFocusVisible(false); setDown(false); groupInteraction?.(false); onBlur?.(event); }}
      style={[style, renderSurface ? { backgroundColor: "transparent" } : null, { position: targetStyle?.position ?? "relative" },
        outerFocusStyle, !visualStyle && !renderSurface ? backgroundStyle : null, !visualStyle ? cornerStyle : null, transformStyle]}
    >
      {visualStyle ? <Animated.View testID="material-visual-surface" pointerEvents="box-none"
        style={[visualStyle, backgroundStyle, cornerStyle, visualFocusRing]}>
        {contents}
      </Animated.View> : contents}
    </ActionPressable>
  );
}
