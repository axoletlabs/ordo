import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Logo, SPLASH_LOGO_WIDTH } from "./ui/Logo";
import { peekRestartCover } from "../store/update-restart";
import { useTheme } from "../theme/ThemeProvider";

interface LaunchSplashProps {
  onPresented?: () => void;
}

/** React fallback matching the native splash for JS reloads and handoff gaps. */
export function LaunchSplash({ onPresented }: LaunchSplashProps) {
  const { palette } = useTheme();
  const cover = peekRestartCover();
  const backgroundColor = cover?.background ?? palette.background;
  const mode = cover?.mode ?? palette.mode;

  useEffect(() => {
    if (!onPresented) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(onPresented);
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [onPresented]);

  return (
    <View
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      collapsable={false}
      style={[styles.root, { backgroundColor }]}
    >
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Logo width={SPLASH_LOGO_WIDTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    elevation: 1000,
  },
});
