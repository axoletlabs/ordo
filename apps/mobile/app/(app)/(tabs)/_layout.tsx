/** Library is home; search and account are contextual top-app-bar destinations. */
import React from "react";
import { Tabs } from "expo-router";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { useAppliedNavigationAnimation, useDetachInactiveTabScenes } from "../../../src/hooks/use-navigation-animation";
import { tabSceneStyleInterpolator, tabScreenAnimation, tabTransitionSpec } from "../../../src/lib/navigation-animation";

export default function LibraryLayout() {
  const { palette } = useTheme();
  const animation = useAppliedNavigationAnimation();
  return (
    <Tabs
      backBehavior="history"
      tabBar={() => null}
      detachInactiveScreens={useDetachInactiveTabScenes(animation)}
      screenOptions={{
        headerShown: false, freezeOnBlur: true, lazy: true,
        animation: tabScreenAnimation(animation), transitionSpec: tabTransitionSpec(animation),
        sceneStyleInterpolator: tabSceneStyleInterpolator(animation),
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Your library" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
