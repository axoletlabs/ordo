/** Skeleton shimmer placeholder. */
import React, { createContext, useContext, useEffect } from "react";
import { type DimensionValue, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  type SharedValue,
} from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { useMaterialMotion } from "../../theme/material-motion";
import { useAnimationActivity } from "../../hooks/use-animation-activity";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radiusKey?: keyof typeof radius;
  style?: ViewStyle;
}

const SkeletonPulseContext = createContext<SharedValue<number> | null>(null);

function useSkeletonPulse() {
  const t = useSharedValue(0.6);
  const { reducedMotion } = useMaterialMotion();
  const active = useAnimationActivity();

  useEffect(() => {
    cancelAnimation(t);
    t.value = 0.6;
    if (active && !reducedMotion) t.value = withRepeat(withSequence(
      withTiming(0.8, { duration: 550, easing: Easing.inOut(Easing.ease) }),
      withTiming(0.4, { duration: 550, easing: Easing.inOut(Easing.ease) }),
    ), -1);
    return () => cancelAnimation(t);
  }, [t, reducedMotion, active]);

  return t;
}

/** A loading region has one clock, not an independent loop per placeholder. */
export function SkeletonGroup({ children }: { children: React.ReactNode }) {
  const pulse = useSkeletonPulse();
  return <SkeletonPulseContext.Provider value={pulse}>{children}</SkeletonPulseContext.Provider>;
}

export function Skeleton(props: SkeletonProps) {
  const pulse = useContext(SkeletonPulseContext);
  return pulse ? <SkeletonSurface {...props} pulse={pulse} /> : <StandaloneSkeleton {...props} />;
}

function StandaloneSkeleton(props: SkeletonProps) {
  const pulse = useSkeletonPulse();
  return <SkeletonSurface {...props} pulse={pulse} />;
}

function SkeletonSurface({ width = "100%", height = 14, radiusKey = "xs", style, pulse }: SkeletonProps & { pulse: SharedValue<number> }) {
  const { palette } = useTheme();
  const animStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const staticStyle: ViewStyle = {
    width,
    height,
    backgroundColor: palette.surfaceSecondary,
    borderRadius: radius[radiusKey],
  };

  return <Animated.View accessible={false} importantForAccessibility="no" style={[staticStyle, animStyle, style]} />;
}
