/**
 * Primary destinations: Bookmarks, Search, Settings. Detail routes live on the
 * parent stack so they animate and unmount instead of staying as hidden tabs.
 */
import React from "react";
import { Tabs } from "expo-router";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout, radius, spacing } from "../../../src/theme/tokens";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import {
  useAppliedNavigationAnimation,
  useDetachInactiveTabScenes,
} from "../../../src/hooks/use-navigation-animation";
import {
  tabSceneStyleInterpolator,
  tabScreenAnimation,
  tabTransitionSpec,
} from "../../../src/lib/navigation-animation";
import { requestSearchFieldFocus } from "../../../src/lib/search-field-focus";
import { useSettingsStore } from "../../../src/store/settings";
import { NAV_CHROME_TEXT } from "../../../src/components/ui/Text";
import {
  Pressable,
  StyleSheet,
  Text as NativeText,
  View,
  type ColorValue,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Stroke on the floating dock shell. The tab bar is laid out inside it. */
const DOCK_BORDER = 1;
/** Dock padding. Each tab uses the same inset as a margin, so the gutter matches on every side. */
const DOCK_PAD = spacing[4];

/**
 * React Navigation's UIKit tab button is top-aligned with a fixed 28×31 icon
 * slot. That leaves the glyph and label high in our bar, and a square active
 * fill. Center the stack and clip the selected fill to the dock's gutter.
 */
function NavigationTabButton({
  style,
  pillRadius,
  hoverEffect: _hoverEffect,
  pressOpacity: _pressOpacity,
  pressColor: _pressColor,
  href: _href,
  ...rest
}: PressableProps & {
  pillRadius: number;
  href?: string;
  hoverEffect?: unknown;
  pressOpacity?: number;
  pressColor?: string;
}) {
  return (
    <Pressable
      {...rest}
      style={[
        style,
        {
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: spacing[2],
          padding: 0,
          paddingVertical: 0,
          paddingHorizontal: 0,
          paddingTop: 0,
          paddingBottom: 0,
          paddingLeft: 0,
          paddingRight: 0,
          borderRadius: pillRadius,
          overflow: "hidden",
        },
      ]}
    />
  );
}

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
  const navigationAnimation = useAppliedNavigationAnimation();
  const detachInactiveScreens = useDetachInactiveTabScenes(navigationAnimation);
  const {
    floating,
    sideNavigation,
    hideBottomNav,
    hideForKeyboard,
    bottom: floatingBottom,
    height: floatingHeight,
  } = useFloatingDockMetrics();
  const tabBarHeight = showNavigationLabels ? layout.tabBarHeight : layout.touchTargetMin;
  const iconSize = 22;
  const dockItemMargin = floating ? DOCK_PAD : 0;
  // Outer radius minus the border and the gutter, so the selected pill's
  // curve stays parallel to the dock instead of crowding the corners.
  const floatingPillRadius = Math.max(0, radius["3xl"] - DOCK_BORDER - DOCK_PAD - dockItemMargin);

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
      top: 0,
      left: 0,
      right: 0,
      start: 0,
      end: 0,
      bottom: 0,
      width: "100%" as const,
      // Same number as the shell's outer height overflows the border and the
      // clip shaves the top of the selected pill.
      height: floatingHeight - DOCK_BORDER * 2,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      paddingLeft: DOCK_PAD,
      paddingRight: DOCK_PAD,
      paddingHorizontal: DOCK_PAD,
      paddingTop: DOCK_PAD,
      paddingBottom: DOCK_PAD,
      paddingVertical: DOCK_PAD,
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
    marginHorizontal: dockItemMargin,
    marginVertical: dockItemMargin,
    borderRadius: floating ? floatingPillRadius : 0,
    overflow: "hidden" as const,
  };

  const renderTabButton = React.useCallback(
    (props: Omit<React.ComponentProps<typeof NavigationTabButton>, "pillRadius">) => (
      <NavigationTabButton {...props} pillRadius={floating ? floatingPillRadius : 0} />
    ),
    [floating, floatingPillRadius],
  );

  const renderTabBar = React.useCallback(
    (props: BottomTabBarProps) => {
      if (sideNavigation) return null;
      if (floating) {
        const focused = props.state.routes[props.state.index];
        const showFloatingDock =
          !hideForKeyboard &&
          !tabBarStyleIsHidden(props.descriptors[focused.key]?.options.tabBarStyle);

        return (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View
              collapsable={false}
              pointerEvents={showFloatingDock ? "auto" : "none"}
              style={{
                position: "absolute",
                left: spacing[16],
                right: spacing[16],
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

  const tabLabel = (label: string, color: ColorValue) => (
    <NativeText
      numberOfLines={1}
      ellipsizeMode="tail"
      style={{
        color,
        textAlign: "center",
        includeFontPadding: false,
        ...NAV_CHROME_TEXT,
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
        detachInactiveScreens={detachInactiveScreens}
        screenOptions={{
          headerShown: false,
          freezeOnBlur: true,
          lazy: true,
          animation: tabScreenAnimation(navigationAnimation),
          transitionSpec: tabTransitionSpec(navigationAnimation),
          sceneStyleInterpolator: tabSceneStyleInterpolator(navigationAnimation),
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
          tabBarButton: renderTabButton,
          tabBarIconStyle: { width: iconSize, height: iconSize },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Bookmarks",
            tabBarItemStyle: tabItemStyle,
            tabBarIcon: ({ color }) => (
              <Ionicons name="bookmark-outline" size={iconSize} color={color} />
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
              <Ionicons name="search-outline" size={iconSize} color={color} />
            ),
            tabBarLabel: ({ color }) => tabLabel("Search", color),
          }}
          listeners={({ navigation }) => ({
            tabPress: () => {
              // Only the retap while Search is already showing. Focusing a
              // frozen off-screen field on the way *to* Search sticks the input.
              if (!navigation.isFocused()) return;
              requestSearchFieldFocus();
            },
          })}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarItemStyle: tabItemStyle,
            tabBarIcon: ({ color }) => (
              <Ionicons name="settings-outline" size={iconSize} color={color} />
            ),
            tabBarLabel: ({ color }) => tabLabel("Settings", color),
          }}
        />
      </Tabs>
    </View>
  );
}
