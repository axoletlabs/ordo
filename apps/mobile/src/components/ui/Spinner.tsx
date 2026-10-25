/**
 * Shared Material shape-morphing loading indicator in both design modes.
 * Standalone indicators use the 48dp container / 38dp active shape; compact
 * variants scale the same geometry for buttons, menus, and inline actions.
 */
import React, { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
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
import Svg, { G, Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { loadingMorphPath, loadingMorphState, MORPH_INTERVAL, MORPH_STEPS } from "../../lib/material-loading";
import { LOADING_SHAPE_SCALE } from "../../lib/material-loading-shapes";
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
  style,
  accessible = true,
  spinning = true,
  contained = false,
}: {
  size?: SpinnerSize | number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessible?: boolean;
  spinning?: boolean;
  /** Tonal circular container, used by pull-to-refresh. */
  contained?: boolean;
}) {
  const { palette } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  const active = useAnimationActivity() && spinning;
  const extent = spinnerExtent(size);
  const indicatorExtent = extent * 38 / 48;
  const morph = useSharedValue(0);
  const rotation = useSharedValue(0);

  useEffect(() => {
    morph.value = 0;
    rotation.value = 0;
    if (active && !reducedMotion) {
      morph.value = withRepeat(withTiming(MORPH_STEPS, {
        duration: MORPH_INTERVAL * MORPH_STEPS, easing: Easing.linear, reduceMotion: ReduceMotion.Never,
      }), -1, false, undefined, ReduceMotion.Never);
      rotation.value = withRepeat(withTiming(360, {
        duration: 4666, easing: Easing.linear, reduceMotion: ReduceMotion.Never,
      }), -1, false, undefined, ReduceMotion.Never);
    }
    return () => { cancelAnimation(morph); cancelAnimation(rotation); };
  }, [active, reducedMotion, morph, rotation]);
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
      accessibilityState={accessible ? { busy: spinning } : undefined}
      aria-hidden={!accessible || undefined}
      importantForAccessibility={accessible ? "auto" : "no"}
      testID={contained ? "material-contained-loading-indicator" : "material-loading-indicator"}
      style={[{ width: extent, height: extent, flexShrink: 0, alignItems: "center", justifyContent: "center",
        borderRadius: extent / 2, backgroundColor: contained ? palette.primaryContainer : "transparent" }, style]}
    >
      <Animated.View aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
        style={[{ width: indicatorExtent, height: indicatorExtent }, shapeRotation]}>
        <Svg width={indicatorExtent} height={indicatorExtent} viewBox="0 0 1 1">
          <G transform={`translate(0.5 0.5) scale(${LOADING_SHAPE_SCALE}) translate(-0.5 -0.5)`}>
            <AnimatedPath animatedProps={shape} d={loadingMorphPath(0, 0)} fill={color ?? (contained ? palette.onPrimaryContainer : palette.primary)} />
          </G>
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

/** Contained variant shared by list and website pull-to-refresh. */
export function ReloadSpinner({
  spinning = true,
}: {
  spinning?: boolean;
}) {
  return <Spinner contained spinning={spinning} accessible={false} />;
}
