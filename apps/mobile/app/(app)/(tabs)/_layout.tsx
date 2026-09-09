/**
 * Primary destinations: Bookmarks, Search, Settings. Detail routes live on the
 * parent stack so they animate and unmount instead of staying as hidden tabs.
 */
import React from "react";
import { Tabs } from "expo-router";
import { BottomTabBar, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout, radius, spacing } from "../../../src/theme/tokens";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import {
  tabScreenAnimation,
  tabTransitionSpec,
} from "../../../src/lib/navigation-animation";
import { requestSearchFieldFocus } from "../../../src/lib/search-field-focus";
import { useSettingsStore } from "../../../src/store/settings";
import { StyleSheet, Text as NativeText, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function tabBarStyleIsHidden(
  style: BottomTabBarProps["descriptors"][string]["options"]["tabBarStyle"],
) {
  const flattened = StyleSheet.flatten(style as ViewStyle | undefined);
  return flattened?.display === "none";
}

export default function TabsLayout() {
  const { palette, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const showNavigationLabels = useSettingsStore((s) => s.showNavigationLabels);
  const navigationAnimation = useSettingsStore((s) => s.navigationAnimation);
  const {
    floating,
    compact,
    sideNavigation,
    hideBottomNav,
    hideForKeyboard,
    bottom: floatingBottom,
    height: floatingHeight,
    windowWidth,
  } = useFloatingDockMetrics();
  const tabBarHeight = showNavigationLabels ? layout.tabBarHeight : layout.touchTargetMin;
  const compactDockWidth = showNavigationLabels
    ? layout.compactFloatingDockWidth
    : layout.compactFloatingDockIconWidth;
  const compactDockLeft = Math.max(0, (windowWidth - compactDockWidth) / 2);

  const tabBarStyle = React.useMemo(() => {
    const reset = {
      borderWidth: 0,
      borderTopWidth: 0,
      borderRadius: 0,
      shadowOpacity: 0,
      elevation: 0,
      zIndex: 0,
    };

    if (sideNavigation) {
      return { ...reset, display: "none" as const };
    }

    if (!floating) {
      return {
        ...reset,
        position: "relative" as const,
        left: 0,
        right: 0,
        start: 0,
        end: 0,
        top: 0,
        bottom: 0,
        width: "auto" as const,
        height: tabBarHeight + insets.bottom,
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        marginBottom: 0,
        paddingBottom: insets.bottom,
        backgroundColor: palette.amoled ? palette.background : palette.surface,
      };
    }

    return {
      ...reset,
      position: "absolute" as const,
      top: null,
      left: 0,
      right: 0,
      start: 0,
      end: 0,
      bottom: 0,
      width: "auto" as const,
      height: floatingHeight,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      paddingLeft: spacing[4],
      paddingRight: spacing[4],
      paddingTop: spacing[4],
      paddingBottom: spacing[4],
      backgroundColor: "transparent",
      borderWidth: 0,
      shadowOpacity: 0,
      elevation: 0,
    };
  }, [
    floating,
    floatingHeight,
    insets.bottom,
    palette.amoled,
    palette.background,
    palette.surface,
    sideNavigation,
    tabBarHeight,
  ]);

  const visibleTabBarStyle = hideBottomNav || hideForKeyboard
    ? { ...tabBarStyle, display: "none" as const }
    : tabBarStyle;

  const tabItemStyle = {
    flex: 1,
    marginHorizontal: floating ? (compact ? spacing[2] : spacing[4]) : 0,
    marginTop: floating ? spacing[4] : 0,
    marginBottom: floating ? spacing[4] : 0,
    borderRadius: floating ? radius.xl : 0,
    overflow: "hidden" as const,
  };

  const renderTabBar = React.useCallback(
    (props: BottomTabBarProps) => {
      if (sideNavigation) return null;
      if (floating) {
        const focused = props.state.routes[props.state.index];
        const showFloatingDock =
          !hideForKeyboard &&
          !tabBarStyleIsHidden(props.descriptors[focused.key]?.options.tabBarStyle);

        return (
          <View key={compact ? "compact-dock" : "full-dock"} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View
              collapsable={false}
              pointerEvents={showFloatingDock ? "auto" : "none"}
              style={{
                position: "absolute",
                left: compact ? compactDockLeft : spacing[16],
                right: compact ? null : spacing[16],
                width: compact ? compactDockWidth : ("auto" as const),
                top: null,
                bottom: floatingBottom,
                height: floatingHeight,
                display: showFloatingDock ? "flex" : "none",
                ...shadows.level3,
              }}
            >
              <View
                style={{
                  flex: 1,
                  overflow: "hidden",
                  backgroundColor: palette.surfaceElevated,
                  borderWidth: 1,
                  borderColor: palette.borderStrong,
                  borderRadius: radius["3xl"],
                }}
              >
                <BottomTabBar key="floating-dock" {...props} />
              </View>
            </View>
          </View>
        );
      }

      return <BottomTabBar key="bottom" {...props} />;
    },
    [
      compact,
      compactDockLeft,
      compactDockWidth,
      floating,
      floatingBottom,
      floatingHeight,
      hideForKeyboard,
      palette.borderStrong,
      palette.surfaceElevated,
      shadows.level3,
      sideNavigation,
    ],
  );

  const tabLabel = (label: string, color: string) => (
    <NativeText
      numberOfLines={1}
      ellipsizeMode="tail"
      style={{
        color,
        fontFamily: "InterTight_500Medium",
        fontSize: compact ? 10 : floating ? 11 : 10,
        lineHeight: compact ? 14 : floating ? 15 : 14,
      }}
    >
      {label}
    </NativeText>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Tabs
        backBehavior="history"
        tabBar={renderTabBar}
        detachInactiveScreens={navigationAnimation === "instant"}
        screenOptions={{
          headerShown: false,
          freezeOnBlur: true,
          lazy: true,
          animation: tabScreenAnimation(navigationAnimation),
          transitionSpec: tabTransitionSpec(navigationAnimation),
          sceneStyle: { backgroundColor: palette.background },
          tabBarPosition: "bottom",
          tabBarVariant: "uikit",
          tabBarLabelPosition: "below-icon",
          // Docked bars can slide themselves away. The floating pill is extra
          // chrome around that bar, so keyboard hiding is owned by `hideForKeyboard`.
          tabBarHideOnKeyboard: !floating,
          tabBarActiveTintColor: palette.accent,
          tabBarInactiveTintColor: palette.textTertiary,
          tabBarShowLabel: showNavigationLabels,
          tabBarActiveBackgroundColor: floating ? palette.accentSoft : "transparent",
          tabBarStyle: visibleTabBarStyle,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Bookmarks",
            tabBarItemStyle: tabItemStyle,
            tabBarIcon: ({ color }) => (
              <Ionicons name="bookmark-outline" size={compact ? 20 : 22} color={color} />
            ),
            tabBarLabel: ({ color }) => tabLabel("Bookmarks", color),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: "Search",
            tabBarItemStyle: tabItemStyle,
            tabBarIcon: ({ color }) => (
              <Ionicons name="search-outline" size={compact ? 20 : 22} color={color} />
            ),
            tabBarLabel: ({ color }) => tabLabel("Search", color),
          }}
          listeners={{
            tabPress: () => {
              requestSearchFieldFocus();
            },
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarItemStyle: tabItemStyle,
            tabBarIcon: ({ color }) => (
              <Ionicons name="settings-outline" size={compact ? 20 : 22} color={color} />
            ),
            tabBarLabel: ({ color }) => tabLabel("Settings", color),
          }}
        />
      </Tabs>
    </View>
  );
}
