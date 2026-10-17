/**
 * Material circular progress, or the Expressive shape-morphing loading indicator.
 */
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G, Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { useMaterialMotion } from "../../theme/material-motion";
import { circularIndeterminateArc } from "../../lib/material-progress";
import { loadingMorphPath, loadingMorphState, MORPH_INTERVAL, MORPH_STEPS } from "../../lib/material-loading";
import { LOADING_SHAPE_SCALE } from "../../lib/material-loading-shapes";

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
  const morph = useSharedValue(0);
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (!spinning || reducedMotion || expressive) {
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
  }, [phase, spinning, reducedMotion, expressive]);

  const stroke = Math.max(2, extent * 0.1);
  const radiusPx = extent / 2 - stroke / 2 - 0.5;
  const circumference = 2 * Math.PI * radiusPx;
  useEffect(() => {
    morph.value = 0;
    rotation.value = 0;
    if (expressive && spinning && !reducedMotion) {
      morph.value = withRepeat(withTiming(MORPH_STEPS, {
        duration: MORPH_INTERVAL * MORPH_STEPS, easing: Easing.linear, reduceMotion: ReduceMotion.Never,
      }), -1, false, undefined, ReduceMotion.Never);
      rotation.value = withRepeat(withTiming(360, {
        duration: 4666, easing: Easing.linear, reduceMotion: ReduceMotion.Never,
      }), -1, false, undefined, ReduceMotion.Never);
    }
    return () => { cancelAnimation(morph); cancelAnimation(rotation); };
  }, [expressive, spinning, reducedMotion, morph, rotation]);
  const arc = useAnimatedProps(() => {
    const motion = !spinning || reducedMotion ? { start: -90, sweep: 90 } : circularIndeterminateArc(phase.value);
    return { strokeDasharray: [circumference * motion.sweep / 360, circumference], strokeDashoffset: -circumference * motion.start / 360 };
  });
  const shape = useAnimatedProps(() => {
    const state = loadingMorphState(morph.value);
    return { d: loadingMorphPath(state.index, state.progress) };
  });
  const shapeRotation = useAnimatedStyle(() => {
    const angle = loadingMorphState(morph.value).rotation + rotation.value;
    return { transform: [{ rotate: `${angle}deg` }] };
  });

  return (
    <Animated.View
      accessible={accessible}
      accessibilityRole={accessible ? "progressbar" : undefined}
      accessibilityLabel={accessible ? "Loading" : undefined}
      importantForAccessibility={accessible ? "auto" : "no"}
      testID={expressive ? "material-loading-indicator" : "material-circular-progress"}
      style={[{ width: extent, height: extent }, style]}
    >
      {expressive ? (
        <Animated.View style={[{ width: extent, height: extent }, shapeRotation]}>
          <Svg width={extent} height={extent} viewBox="0 0 1 1">
            <G transform={`translate(0.5 0.5) scale(${LOADING_SHAPE_SCALE}) translate(-0.5 -0.5)`}>
              <AnimatedPath animatedProps={shape} d={loadingMorphPath(0, 0)} fill={color ?? palette.primary} />
            </G>
          </Svg>
        </Animated.View>
      ) : <Svg width={extent} height={extent} viewBox={`0 0 ${extent} ${extent}`}>
        <AnimatedCircle animatedProps={arc}
          cx={extent / 2}
          cy={extent / 2}
          r={radiusPx}
          stroke={color ?? palette.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>}
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
