/** Material circular progress; Expressive mode uses the reference's wavy arc. */
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing, ReduceMotion, cancelAnimation, useAnimatedProps, useDerivedValue, useSharedValue,
  withRepeat, withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { useMaterialMotion } from "../../theme/material-motion";
import { circularIndeterminateArc, circularProgressPaths } from "../../lib/material-progress";
import { useAnimationActivity } from "../../hooks/use-animation-activity";

const SIZES = { sm: 16, md: 20, lg: 24 } as const;
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type SpinnerSize = keyof typeof SIZES;

export function spinnerExtent(size: SpinnerSize | number = "md"): number {
  return typeof size === "number" ? size : SIZES[size];
}

export function Spinner({
  size = "md",
  color,
  trackColor,
  label = "Loading",
  style,
  accessible = true,
  spinning = true,
}: {
  size?: SpinnerSize | number;
  color?: string;
  trackColor?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
  accessible?: boolean;
  spinning?: boolean;
}) {
  const { palette, expressive } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  const active = useAnimationActivity() && spinning;
  const extent = spinnerExtent(size);
  const customColor = color != null && color !== palette.primary;
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
      importantForAccessibility={accessible ? "auto" : "no"}
      testID={expressive ? "material-wavy-circular-progress" : "material-circular-progress"}
      style={[{ width: extent, height: extent }, style]}
    >
      <Svg width={extent} height={extent} viewBox="0 0 40 40">
        {expressive ? <AnimatedPath animatedProps={track} stroke={trackColor ?? (customColor ? color : palette.secondaryContainer)}
          strokeOpacity={customColor && !trackColor ? 0.24 : 1} strokeWidth={4} strokeLinecap="round" fill="none" /> : null}
        <AnimatedPath animatedProps={indicator} stroke={color ?? palette.primary}
          strokeWidth={4} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** Elevated chip around the spinner — the website pull-to-refresh HUD. */
export function ReloadSpinner({
  color,
  backgroundColor,
  borderColor,
  spinning = true,
}: {
  color?: string;
  backgroundColor: string;
  borderColor: string;
  spinning?: boolean;
}) {
  return (
    <View style={[styles.chip, { backgroundColor, borderColor }]}>
      <Spinner size="lg" color={color} spinning={spinning} accessible={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
