/**
 * Material grow/shrink arc shared by buttons, lists, refresh and overlays.
 */
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { useMaterialMotion } from "../../theme/material-motion";
import { circularIndeterminateArc } from "../../lib/material-progress";

const SIZES = { sm: 16, md: 20, lg: 24 } as const;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type SpinnerSize = keyof typeof SIZES;

export function spinnerExtent(size: SpinnerSize | number = "md"): number {
  return typeof size === "number" ? size : SIZES[size];
}

export function Spinner({
  size = "md",
  color,
  style,
  accessible = true,
  spinning = true,
}: {
  size?: SpinnerSize | number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessible?: boolean;
  spinning?: boolean;
}) {
  const { palette, expressive } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  const extent = spinnerExtent(size);
  const phase = useSharedValue(0);

  useEffect(() => {
    if (!spinning || reducedMotion) {
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
  }, [phase, spinning, reducedMotion]);

  const stroke = Math.max(2, extent * 0.1);
  const radiusPx = extent / 2 - stroke / 2 - 0.5;
  const circumference = 2 * Math.PI * radiusPx;
  const wave = React.useMemo(() => {
    const points = Array.from({ length: 97 }, (_, index) => {
      const angle = index / 96 * Math.PI * 2;
      const amplitude = extent * 0.045;
      const r = radiusPx - amplitude + amplitude * Math.sin(angle * 6);
      return { x: extent / 2 + r * Math.cos(angle), y: extent / 2 + r * Math.sin(angle) };
    });
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return { path: points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(" "), length };
  }, [extent, radiusPx]);
  const arc = useAnimatedProps(() => {
    const motion = !spinning || reducedMotion ? { start: -90, sweep: 90 } : circularIndeterminateArc(phase.value);
    const length = expressive ? wave.length : circumference;
    return { strokeDasharray: [length * motion.sweep / 360, length], strokeDashoffset: -length * motion.start / 360 };
  });

  return (
    <Animated.View
      accessible={accessible}
      accessibilityRole={accessible ? "progressbar" : undefined}
      accessibilityLabel={accessible ? "Loading" : undefined}
      importantForAccessibility={accessible ? "auto" : "no"}
      testID="material-circular-progress"
      style={[{ width: extent, height: extent }, style]}
    >
      <Svg width={extent} height={extent} viewBox={`0 0 ${extent} ${extent}`}>
        {expressive ? <AnimatedPath animatedProps={arc} d={wave.path} stroke={color ?? palette.primary} strokeWidth={stroke}
          strokeLinecap="round" strokeLinejoin="round" fill="none" /> : <AnimatedCircle animatedProps={arc}
          cx={extent / 2}
          cy={extent / 2}
          r={radiusPx}
          stroke={color ?? palette.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />}
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
      <Spinner color={color} spinning={spinning} accessible={false} />
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
