import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Logo, SPLASH_LOGO_WIDTH } from "./ui/Logo";
import { useTheme } from "../theme/ThemeProvider";

interface LaunchSplashProps {
  transitionIn?: boolean;
  onPresented?: () => void;
}

/** React fallback matching the native splash for JS reloads and handoff gaps. */
export function LaunchSplash({ transitionIn = false, onPresented }: LaunchSplashProps) {
  const { palette } = useTheme();
  const backgroundColor = palette.background;
  const progress = useRef(new Animated.Value(transitionIn ? 0 : 1)).current;

  useEffect(() => {
    if (!onPresented) return;
    if (!transitionIn) {
      const frame = requestAnimationFrame(onPresented);
      return () => cancelAnimationFrame(frame);
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onPresented();
    });
    return () => animation.stop();
  }, [onPresented, progress, transitionIn]);

  return (
    <View
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      collapsable={false}
      style={[styles.root, { backgroundColor }]}
    >
      <StatusBar
        style={palette.mode === "dark" ? "light" : "dark"}
        backgroundColor={backgroundColor}
      />
      <Animated.View
        style={{
          opacity: progress,
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.97, 1],
              }),
            },
          ],
        }}
      >
        <Logo width={SPLASH_LOGO_WIDTH} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    elevation: 1000,
  },
});
