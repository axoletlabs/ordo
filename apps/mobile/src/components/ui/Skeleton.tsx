/** Skeleton shimmer placeholder. */
import React, { useEffect } from "react";
import { type DimensionValue, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
  cancelAnimation,
  useReducedMotion,
} from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radiusKey?: keyof typeof radius;
  style?: ViewStyle;
}

export function Skeleton({ width = "100%", height = 14, radiusKey = "xs", style }: SkeletonProps) {
  const { palette } = useTheme();
  const t = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!reducedMotion) t.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), -1);
    return () => cancelAnimation(t);
  }, [t, reducedMotion]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.5, 1], [0.4, 0.8, 0.4]),
  }));

  const staticStyle: ViewStyle = {
    width,
    height,
    backgroundColor: palette.surfaceSecondary,
    borderRadius: radius[radiusKey],
  };

  return <Animated.View style={[staticStyle, animStyle, style]} />;
}
