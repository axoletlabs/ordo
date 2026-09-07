/**
 * Authenticated app layout — tabbed (Bookmarks · Search · Settings).
 * Detail routes stay focused on phones and retain the navigation rail when
 * there is enough horizontal room.
 */
import React from "react";
import { Tabs, usePathname } from "expo-router";
import { BottomTabBar, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/theme/ThemeProvider";
import { layout, radius, spacing } from "../../src/theme/tokens";
import { useServerInfo, useValidateSession } from "../../src/hooks/queries";
import { useFloatingDockMetrics } from "../../src/hooks/use-floating-dock-metrics";
import { useAuthStore } from "../../src/store/auth";
import { useSettingsStore } from "../../src/store/settings";
import { MfaEnrollmentScreen } from "../../src/components/auth/MfaEnrollmentScreen";
import { StyleSheet, Text as NativeText, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const HIDDEN = {
  href: null,
};

function tabBarStyleIsHidden(
  style: BottomTabBarProps["descriptors"][string]["options"]["tabBarStyle"],
) {
  const flattened = StyleSheet.flatten(style as ViewStyle | undefined);
  return flattened?.display === "none";
}

export default function AppLayout() {
  const { palette, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const { data: serverInfo } = useServerInfo();
  const showNavigationLabels = useSettingsStore((s) => s.showNavigationLabels);
  const {
    floating,
    compact,
    sideNavigation,
    hideBottomNav,
    bottom: floatingBottom,
    height: floatingHeight,
    windowWidth,
    windowHeight,
  } = useFloatingDockMetrics();
  const tabBarHeight = showNavigationLabels ? layout.tabBarHeight : layout.touchTargetMin;
  const railWidth = showNavigationLabels
    ? compact
      ? layout.compactNavigationRailWidth
      : layout.navigationRailWidth
    : spacing[56];
  const compactDockWidth = showNavigationLabels
    ? layout.compactFloatingDockWidth
    : layout.compactFloatingDockIconWidth;
  const compactRailHeight = showNavigationLabels
    ? layout.compactNavigationRailHeight
    : layout.compactNavigationRailIconHeight;
  const compactDockLeft = Math.max(0, (windowWidth - compactDockWidth) / 2);
  const compactRailTop = Math.max(0, (windowHeight - compactRailHeight) / 2);
  const railInset = Math.max(insets.left, spacing[8]);
  const tabBarStyle = React.useMemo(
    () => {
      // Geometry for the reused native tab bar. Portrait floating docks are
      // positioned by a wrapper (see renderTabBar); this style only fills that
      // shell. Leave `top` null so Yoga cannot pin a leaked bar to the screen top.
      const reset = {
        borderWidth: 0,
        borderTopWidth: 0,
        borderRadius: 0,
        shadowOpacity: 0,
        elevation: 0,
        zIndex: 0,
      };

      if (sideNavigation) {
        if (!floating) {
          return {
            ...reset,
            position: "relative" as const,
            left: 0,
            right: null,
            start: 0,
            end: null,
            top: 0,
            bottom: 0,
            width: railWidth + insets.left,
            height: "auto" as const,
            marginLeft: 0,
            marginRight: 0,
            marginTop: 0,
            marginBottom: 0,
            paddingLeft: insets.left + spacing[4],
            paddingRight: spacing[4],
            paddingTop: insets.top + spacing[6],
            paddingBottom: insets.bottom + spacing[6],
            backgroundColor: palette.amoled ? palette.background : palette.surface,
          };
        }

        const compactGeometry = compact
          ? {
              top: compactRailTop,
              bottom: null,
              height: compactRailHeight,
              marginTop: 0,
              marginBottom: 0,
            }
          : {
              top: Math.max(insets.top, spacing[12]),
              bottom: Math.max(insets.bottom, spacing[12]),
              height: "auto" as const,
              marginTop: 0,
              marginBottom: 0,
            };

        return {
          ...reset,
          ...compactGeometry,
          position: "absolute" as const,
          left: railInset,
          right: null,
          start: railInset,
          end: null,
          width: railWidth,
          marginLeft: 0,
          marginRight: 0,
          paddingLeft: spacing[4],
          paddingRight: spacing[4],
          paddingTop: spacing[4],
          paddingBottom: spacing[4],
          backgroundColor: palette.surfaceElevated,
          borderWidth: 1,
          borderColor: palette.borderStrong,
          borderRadius: radius["3xl"],
          zIndex: 20,
          ...shadows.level3,
        };
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
    },
    [
      floating,
      compact,
      compactRailHeight,
      compactRailTop,
      floatingHeight,
      insets.bottom,
      insets.left,
      insets.top,
      palette.amoled,
      palette.background,
      palette.borderStrong,
      palette.surface,
      palette.surfaceElevated,
      railInset,
      railWidth,
      shadows.level3,
      sideNavigation,
      tabBarHeight,
    ],
  );
  const visibleTabBarStyle = hideBottomNav
    ? { ...tabBarStyle, display: "none" as const }
    : tabBarStyle;
  const hiddenOptions = React.useMemo(
    () =>
      sideNavigation
        ? { ...HIDDEN, tabBarStyle }
        : { ...HIDDEN, tabBarStyle: { display: "none" as const } },
    [sideNavigation, tabBarStyle],
  );
  // Detail routes are tabs, so they stay mounted after the first visit unless
  // we opt out. Form screens that hold passwords or OTPs must remount or the
  // previous values (and loading/success locks) come back on the next visit.
  const formScreenOptions = React.useMemo(
    () => ({ ...hiddenOptions, unmountOnBlur: true }),
    [hiddenOptions],
  );
  const activeSection = pathname.startsWith("/settings")
    ? "settings"
    : pathname.startsWith("/search")
      ? "search"
      : "bookmarks";
  const tabItemStyle = (section: typeof activeSection) => ({
    flex: sideNavigation ? 0 : 1,
    marginHorizontal: floating ? (sideNavigation || compact ? spacing[2] : spacing[4]) : 0,
    marginTop: sideNavigation && section === "bookmarks" ? ("auto" as const) : floating ? spacing[4] : 0,
    marginBottom: sideNavigation && section === "settings" ? ("auto" as const) : floating ? spacing[4] : 0,
    borderRadius: floating ? radius.xl : 0,
    overflow: "hidden" as const,
    backgroundColor:
      floating && activeSection === section ? palette.accentSoft : "transparent",
  });
  const tabColor = (section: typeof activeSection, fallback: string) =>
    activeSection === section ? palette.accent : fallback;
  const tabLabel = (section: typeof activeSection, label: string, fallback: string) => (
    <NativeText
      numberOfLines={1}
      ellipsizeMode="tail"
      style={{
        color: tabColor(section, fallback),
        fontFamily: "InterTight_500Medium",
        fontSize: compact ? 10 : floating ? 11 : 10,
        lineHeight: compact ? 14 : floating ? 15 : 14,
      }}
    >
      {label}
    </NativeText>
  );
  // Reconcile local session with the server once authenticated.
  useValidateSession();

  // Keep <Tabs> mounted even while MFA enrollment is required. Replacing the
  // navigator (or swapping in a full-screen spinner while server info loads)
  // unmounted routes and kicked Settings → Account back to Home.
  const needsMfaEnrollment = Boolean(serverInfo?.mfaRequired && user && !user.mfaEnabled);

  const renderTabBar = React.useCallback(
    (props: BottomTabBarProps) => {
      // Own the floating dock's screen position with a View that is never the
      // landscape rail. Pinning the reused native tab bar with `top` used the
      // window height, which does not match the navigator parent after rotate.
      //
      // Keep this shell mounted on every portrait floating route. Gating it on
      // pathname unwrapped the bar while back-navigation had already applied
      // the visible dock style, so it flashed at the top of the screen.
      if (floating && !sideNavigation) {
        const focused = props.state.routes[props.state.index];
        const showFloatingDock = !tabBarStyleIsHidden(
          props.descriptors[focused.key]?.options.tabBarStyle,
        );

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

      return <BottomTabBar key={sideNavigation ? "rail" : "bottom"} {...props} />;
    },
    [
      compact,
      compactDockLeft,
      compactDockWidth,
      floating,
      floatingBottom,
      floatingHeight,
      palette.borderStrong,
      palette.surfaceElevated,
      shadows.level3,
      sideNavigation,
    ],
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Tabs
        backBehavior="history"
        tabBar={renderTabBar}
        screenOptions={{
          headerShown: false,
          tabBarPosition: sideNavigation ? "left" : "bottom",
          tabBarVariant: sideNavigation ? "material" : "uikit",
          tabBarLabelPosition: "below-icon",
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: palette.accent,
          tabBarInactiveTintColor: palette.textTertiary,
          tabBarShowLabel: showNavigationLabels,
          tabBarActiveBackgroundColor: "transparent",
          tabBarStyle: visibleTabBarStyle,
          sceneStyle:
            sideNavigation && floating
              ? { marginStart: railInset + railWidth + spacing[12] }
              : undefined,
        }}
      >
      <Tabs.Screen
        name="index"
        options={{
          title: "Bookmarks",
          tabBarItemStyle: tabItemStyle("bookmarks"),
          tabBarIcon: ({ color }) => (
            <Ionicons name="bookmark-outline" size={compact ? 20 : 22} color={tabColor("bookmarks", color)} />
          ),
          tabBarLabel: ({ color }) => tabLabel("bookmarks", "Bookmarks", color),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarItemStyle: tabItemStyle("search"),
          tabBarIcon: ({ color }) => (
            <Ionicons name="search-outline" size={compact ? 20 : 22} color={tabColor("search", color)} />
          ),
          tabBarLabel: ({ color }) => tabLabel("search", "Search", color),
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: "Settings",
          tabBarItemStyle: tabItemStyle("settings"),
          tabBarIcon: ({ color }) => (
            <Ionicons name="settings-outline" size={compact ? 20 : 22} color={tabColor("settings", color)} />
          ),
          tabBarLabel: ({ color }) => tabLabel("settings", "Settings", color),
        }}
      />
      {/* Hidden detail routes */}
      <Tabs.Screen name="folder/[id]" options={hiddenOptions} />
      <Tabs.Screen name="reader/[id]" options={hiddenOptions} />
      <Tabs.Screen name="tags/index" options={hiddenOptions} />
      <Tabs.Screen name="tags/[id]" options={hiddenOptions} />
      <Tabs.Screen name="settings/sessions" options={hiddenOptions} />
      <Tabs.Screen name="settings/about" options={hiddenOptions} />
      <Tabs.Screen name="settings/account" options={hiddenOptions} />
      <Tabs.Screen name="settings/appearance" options={hiddenOptions} />
      <Tabs.Screen name="settings/controls" options={hiddenOptions} />
      <Tabs.Screen name="settings/data" options={hiddenOptions} />
      <Tabs.Screen name="settings/server" options={hiddenOptions} />
      <Tabs.Screen name="settings/display-name" options={formScreenOptions} />
      <Tabs.Screen name="settings/security" options={formScreenOptions} />
      <Tabs.Screen name="settings/email" options={formScreenOptions} />
      <Tabs.Screen name="settings/verify-email" options={formScreenOptions} />
      <Tabs.Screen name="settings/password" options={formScreenOptions} />
      <Tabs.Screen name="settings/delete-account" options={formScreenOptions} />
      </Tabs>
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
