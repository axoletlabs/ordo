/**
 * Pressable with optional scale-down. Navigation rows pass `scaleTo={1}` so
 * freeze-on-blur does not snapshot a squashed row mid-spring.
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
  withTiming,
  interpolate,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, "onPressIn" | "onPressOut"> & {
  /** Max press depth (0–1). Default 0.97. Pass 1 to skip scale (navigation). */
  scaleTo?: number;
  /** Dim opacity while pressed. Default false — scale is enough feedback. */
  dim?: boolean;
  onPressIn?: (e: GestureResponderEvent) => void;
  onPressOut?: (e: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
};

export function PressableScale({
  scaleTo = 0.97,
  dim = false,
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
      pressed.value = withTiming(1, { duration: 50 });
      onPressIn?.(e);
    },
    [disabled, onPressIn, pressed],
  );

  const handleOut = useCallback(
    (e: GestureResponderEvent) => {
      cancelAnimation(pressed);
      pressed.value = 0;
      onPressOut?.(e);
    },
    [onPressOut, pressed],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = dim ? interpolate(pressed.value, [0, 1], [1, 0.7]) : 1;
    if (scaleTo === 1) return { opacity };
    return {
      transform: [{ scale: interpolate(pressed.value, [0, 1], [1, scaleTo]) }],
      opacity,
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
