/**
 * Auth group layout — full-screen, no header. Themed background.
 */
import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useReducedMotionPreference } from "../../src/hooks/use-reduced-motion-preference";

export default function AuthLayout() {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotionPreference();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
        animation: reducedMotion ? "none" : "fade",
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="mfa" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="verify-email" />
    </Stack>
  );
}
