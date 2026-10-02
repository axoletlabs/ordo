/**
 * Animated password-visibility toggle: spring crossfade between eye (masked)
 * and eye-off (visible) for a smooth morph.
 */
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { PressableScale } from "./PressableScale";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { haptics } from "../../lib/haptics";
import { iconGlyphStyle } from "../../theme/icon-glyph";

export interface EyeToggleProps {
  /** Whether the secret is currently shown. */
  visible: boolean;
  onPress: () => void;
  size?: number;
}

export function EyeToggle({ visible, onPress, size = 24 }: EyeToggleProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  // 0 = masked (eye shown), 1 = visible (eye-off shown)
  const v = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    v.value = motion.reducedMotion ? +visible : withSpring(+visible, motion.fast);
  }, [visible, v, motion.fast, motion.reducedMotion]);

  const eyeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(v.value, [0, 1], [1, 0.5], Extrapolation.CLAMP) }],
  }));

  const eyeOffStyle = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(v.value, [0, 1], [0.5, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <PressableScale
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      hitSlop={8}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityLabel={visible ? "Hide password" : "Show password"}
    >
      <Animated.View style={[styles.icon, eyeStyle]} pointerEvents="none">
        <Ionicons name="eye-outline" size={size} color={palette.textTertiary} style={iconGlyphStyle(size)} />
      </Animated.View>
      <Animated.View style={[styles.icon, eyeOffStyle]} pointerEvents="none">
        <Ionicons name="eye-off-outline" size={size} color={palette.textTertiary} style={iconGlyphStyle(size)} />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  icon: { position: "absolute" },
});
