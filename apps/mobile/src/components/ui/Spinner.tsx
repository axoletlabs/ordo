/**
 * Loading mark used by the in-app website reload HUD. Same arc everywhere
 * so list footers, buttons, and overlays do not pick up the OS spinner.
 */
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  useReducedMotion,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";

const SIZES = { sm: 16, md: 20, lg: 24 } as const;

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
  const reducedMotion = useReducedMotion();
  const extent = spinnerExtent(size);
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (!spinning || reducedMotion) {
      cancelAnimation(rotation);
      rotation.value = 0;
      return;
    }
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: 750, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(rotation);
  }, [rotation, spinning, reducedMotion]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

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

  return (
    <Animated.View
      accessible={accessible}
      accessibilityRole={accessible ? "progressbar" : undefined}
      accessibilityLabel={accessible ? "Loading" : undefined}
      importantForAccessibility={accessible ? "auto" : "no"}
      style={[{ width: extent, height: extent }, spinStyle, style]}
    >
      <Svg width={extent} height={extent} viewBox={`0 0 ${extent} ${extent}`}>
        {expressive ? <Path d={wave.path} stroke={color ?? palette.primary} strokeWidth={stroke}
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${wave.length * 0.72} ${wave.length}`} fill="none" /> : <Circle
          cx={extent / 2}
          cy={extent / 2}
          r={radiusPx}
          stroke={color ?? palette.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.72} ${circumference}`}
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
      <Spinner color={color} spinning={spinning} />
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
