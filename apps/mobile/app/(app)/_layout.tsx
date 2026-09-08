/**
 * Authenticated app layout — a stack over the three primary tabs so folder,
 * reader, tags, and settings details get a real push/pop instead of a tab swap.
 * The landscape rail is owned here so it stays on those detail screens.
 */
import React from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { enableFreeze } from "react-native-screens";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useServerInfo, useValidateSession } from "../../src/hooks/queries";
import { useFloatingDockMetrics } from "../../src/hooks/use-floating-dock-metrics";
import { useAuthStore } from "../../src/store/auth";
import { MfaEnrollmentScreen } from "../../src/components/auth/MfaEnrollmentScreen";
import { NavigationRail, useRailSceneOffset } from "../../src/components/navigation/NavigationRail";

enableFreeze(true);

const DETAIL_ANIMATION = Platform.OS === "web" ? "fade" : "slide_from_right";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

export default function AppLayout() {
  const { palette } = useTheme();
  const user = useAuthStore((s) => s.user);
  const { data: serverInfo } = useServerInfo();
  const { floating, sideNavigation } = useFloatingDockMetrics();
  const sceneOffset = useRailSceneOffset();
  useValidateSession();

  const needsMfaEnrollment = Boolean(serverInfo?.mfaRequired && user && !user.mfaEnabled);

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: DETAIL_ANIMATION,
        animationDuration: 220,
        freezeOnBlur: true,
        contentStyle: { backgroundColor: palette.background, ...sceneOffset },
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="folder/[id]" />
      <Stack.Screen name="reader/[id]" />
      <Stack.Screen name="tags/index" />
      <Stack.Screen name="tags/[id]" />
      <Stack.Screen name="settings/sessions" />
      <Stack.Screen name="settings/about" />
      <Stack.Screen name="settings/account" />
      <Stack.Screen name="settings/appearance" />
      <Stack.Screen name="settings/controls" />
      <Stack.Screen name="settings/data" />
      <Stack.Screen name="settings/server" />
      <Stack.Screen name="settings/display-name" />
      <Stack.Screen name="settings/security" />
      <Stack.Screen name="settings/email" />
      <Stack.Screen name="settings/verify-email" />
      <Stack.Screen name="settings/password" />
      <Stack.Screen name="settings/delete-account" />
    </Stack>
  );

  return (
    <View
      style={
        sideNavigation && !floating
          ? { flex: 1, flexDirection: "row", backgroundColor: palette.background }
          : { flex: 1, backgroundColor: palette.background }
      }
    >
      {sideNavigation && !floating ? <NavigationRail /> : null}
      <View style={{ flex: 1 }}>{stack}</View>
      {sideNavigation && floating ? <NavigationRail /> : null}
      {needsMfaEnrollment ? (
        <View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 40,
            elevation: 40,
            backgroundColor: palette.background,
          }}
        >
          <MfaEnrollmentScreen />
        </View>
      ) : null}
    </View>
  );
}
