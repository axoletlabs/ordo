/**
 * Animated password-visibility toggle: spring crossfade between eye (masked)
 * and eye-off (visible) for a smooth morph.
 */
import React, { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeProvider";
import { springs } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";

export interface EyeToggleProps {
  /** Whether the secret is currently shown. */
  visible: boolean;
  onPress: () => void;
  size?: number;
}

export function EyeToggle({ visible, onPress, size = 18 }: EyeToggleProps) {
  const { palette } = useTheme();
  // 0 = masked (eye shown), 1 = visible (eye-off shown)
  const v = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    v.value = withSpring(visible ? 1 : 0, springs.snappy);
  }, [visible, v]);

  const eyeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(v.value, [0, 1], [1, 0.5], Extrapolation.CLAMP) }],
  }));

  const eyeOffStyle = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(v.value, [0, 1], [0.5, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <Pressable
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
        <Ionicons name="eye-outline" size={size} color={palette.textTertiary} />
      </Animated.View>
      <Animated.View style={[styles.icon, eyeOffStyle]} pointerEvents="none">
        <Ionicons name="eye-off-outline" size={size} color={palette.textTertiary} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  icon: { position: "absolute" },
});
