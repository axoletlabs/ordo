/** Material circular progress; Expressive mode uses the reference's wavy arc. */
import React, { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing, ReduceMotion, cancelAnimation, useAnimatedProps, useDerivedValue, useSharedValue,
  withRepeat, withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { circularIndeterminateArc, circularProgressPaths } from "../../lib/material-progress";
import { useAnimationActivity } from "../../hooks/use-animation-activity";

const SIZES = { sm: 20, md: 32, lg: 48 } as const;
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type SpinnerSize = keyof typeof SIZES;

export function spinnerExtent(size: SpinnerSize | number = "lg"): number {
  return typeof size === "number" ? size : SIZES[size];
}

export function Spinner({
  size = "lg",
  color,
  trackColor,
  label = "Loading",
  style,
  accessible = true,
  spinning = true,
  contained = false,
}: {
  size?: SpinnerSize | number;
  color?: string;
  trackColor?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
  accessible?: boolean;
  spinning?: boolean;
  /** Tonal circular container, used by pull-to-refresh. */
  contained?: boolean;
}) {
  const { palette, expressive } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  const active = useAnimationActivity() && spinning;
  const extent = spinnerExtent(size);
  const indicatorExtent = contained ? extent * 38 / 48 : extent;
  const foreground = color ?? (contained ? palette.onPrimaryContainer : palette.primary);
  const customColor = foreground !== palette.primary;
  const phase = useSharedValue(0);

  useEffect(() => {
    if (!active || reducedMotion) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(1, { duration: 5400, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      -1,
      false,
      undefined,
      ReduceMotion.Never,
    );
    return () => cancelAnimation(phase);
  }, [phase, active, reducedMotion]);

  const paths = useDerivedValue(() => {
    const arc = !spinning || reducedMotion ? { start: -90, sweep: 90 } : circularIndeterminateArc(phase.value);
    return circularProgressPaths(arc.start, arc.sweep, expressive);
  });
  const indicator = useAnimatedProps(() => ({ d: paths.value.indicator }));
  const track = useAnimatedProps(() => ({ d: paths.value.track }));

  return (
    <Animated.View
      accessible={accessible}
      accessibilityRole={accessible ? "progressbar" : undefined}
      accessibilityLabel={accessible ? label : undefined}
      accessibilityState={accessible ? { busy: spinning } : undefined}
      aria-hidden={!accessible || undefined}
      importantForAccessibility={accessible ? "auto" : "no"}
      testID={expressive ? "material-wavy-circular-progress" : "material-circular-progress"}
      style={[{ width: extent, height: extent, flexShrink: 0, alignItems: "center", justifyContent: "center",
        borderRadius: extent / 2, backgroundColor: contained ? palette.primaryContainer : "transparent" }, style]}
    >
      <Svg width={indicatorExtent} height={indicatorExtent} viewBox="0 0 40 40"
        aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {expressive ? <AnimatedPath animatedProps={track} stroke={trackColor ?? (customColor ? foreground : palette.secondaryContainer)}
          strokeOpacity={customColor && !trackColor ? 0.24 : 1} strokeWidth={4} strokeLinecap="round" fill="none" /> : null}
        <AnimatedPath animatedProps={indicator} stroke={foreground}
          strokeWidth={4} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** Contained variant shared by list and website pull-to-refresh. */
export function ReloadSpinner({ spinning = true }: { spinning?: boolean }) {
  return <Spinner contained spinning={spinning} accessible={false} />;
}
