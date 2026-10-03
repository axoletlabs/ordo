/** Library is home; search and account are contextual top-app-bar destinations. */
import React from "react";
import { Tabs } from "expo-router";
import { useTheme } from "../../../src/theme/ThemeProvider";

export default function LibraryLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      backBehavior="history"
      tabBar={() => null}
      detachInactiveScreens={false}
      screenOptions={{
        headerShown: false, freezeOnBlur: true, lazy: true,
        animation: "none",
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Your library" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
    </Tabs>
  );
}
