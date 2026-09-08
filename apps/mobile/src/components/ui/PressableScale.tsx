/**
 * Reusable pressable with a spring scale-down on press (Reanimated 3).
 * The worklet runs on the UI thread → 60fps.
 */
import React, { useCallback } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  cancelAnimation,
  withSpring,
  interpolate,
} from "react-native-reanimated";
import { springs } from "../../theme/tokens";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, "onPressIn" | "onPressOut"> & {
  /** Max press depth (0–1). Default 0.97. */
  scaleTo?: number;
  /** Dim opacity while pressed. Default true. */
  dim?: boolean;
  onPressIn?: (e: GestureResponderEvent) => void;
  onPressOut?: (e: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
};

export function PressableScale({
  scaleTo = 0.97,
  dim = true,
  onPressIn,
  onPressOut,
  disabled,
  style,
  children,
  ...rest
}: PressableScaleProps) {
  const pressed = useSharedValue(0);

  React.useEffect(
    () => () => {
      cancelAnimation(pressed);
    },
    [pressed],
  );

  const handleIn = useCallback(
    (e: GestureResponderEvent) => {
      if (disabled) return;
      pressed.value = withSpring(1, springs.snappy);
      onPressIn?.(e);
    },
    [disabled, onPressIn, pressed],
  );

  const handleOut = useCallback(
    (e: GestureResponderEvent) => {
      pressed.value = withSpring(0, springs.snappy);
      onPressOut?.(e);
    },
    [onPressOut, pressed],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const s = interpolate(pressed.value, [0, 1], [1, scaleTo]);
    return {
      transform: [{ scale: s }],
      opacity: dim ? interpolate(pressed.value, [0, 1], [1, 0.7]) : 1,
    };
  });

  return (
    <AnimatedPressable
      onPressIn={handleIn}
      onPressOut={handleOut}
      disabled={disabled}
      style={[style as StyleProp<ViewStyle>, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
