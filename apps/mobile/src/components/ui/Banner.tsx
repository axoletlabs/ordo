/** Non-intrusive top banner (connection status / sync errors). */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { contentInset } from "../../theme/alignment";
import { radius, spacing } from "../../theme/tokens";
import { useMaterialMotion } from "../../theme/material-motion";

export interface BannerProps {
  message: string;
  visible: boolean;
  tone?: "warning" | "danger";
  icon?: React.ReactNode;
}

export function Banner({ message, visible, tone = "warning", icon }: BannerProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const insets = useSafeAreaInsets();
  const h = useSharedValue(0);

  useEffect(() => {
    h.value = motion.reducedMotion ? +visible : visible
      ? withSpring(1, motion.spatial)
      : withTiming(0, { duration: 220, easing: Easing.inOut(Easing.ease) });
  }, [visible, h, motion.spatial, motion.reducedMotion]);

  const bg = tone === "danger" ? palette.errorContainer : palette.tertiaryContainer;
  const fg = tone === "danger" ? palette.onErrorContainer : palette.onTertiaryContainer;

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(h.value, [0, 1], [-60, 0]) }],
    opacity: h.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          paddingTop: insets.top,
          paddingLeft: contentInset(insets.left),
          paddingRight: contentInset(insets.right),
        },
        style,
      ]}
    >
      <View style={[styles.inner, { backgroundColor: bg, borderRadius: radius.lg }]}>
        {icon}
        <Text variant="bodyMedium" style={{ color: fg, flex: 1 }}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 50 },
  inner: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    paddingHorizontal: spacing[14],
    paddingVertical: spacing[10],
  },
});
