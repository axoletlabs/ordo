/**
 * Landscape / wide-window rail. Lives on the app stack so folder, reader, and
 * settings detail screens keep the same chrome as the three primary tabs.
 */
import React from "react";
import { Pressable, StyleSheet, Text as NativeText, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeProvider";
import { useFloatingDockMetrics } from "../../hooks/use-floating-dock-metrics";
import { useSettingsStore } from "../../store/settings";
import { layout, radius, spacing } from "../../theme/tokens";

type Section = "bookmarks" | "search" | "settings";

const ITEMS: {
  href: "/" | "/search" | "/settings";
  section: Section;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { href: "/", section: "bookmarks", label: "Bookmarks", icon: "bookmark-outline" },
  { href: "/search", section: "search", label: "Search", icon: "search-outline" },
  { href: "/settings", section: "settings", label: "Settings", icon: "settings-outline" },
];

function sectionFromPath(pathname: string): Section {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/search")) return "search";
  return "bookmarks";
}

export function NavigationRail() {
  const { palette, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const showLabels = useSettingsStore((s) => s.showNavigationLabels);
  const {
    floating,
    compact,
    windowHeight,
  } = useFloatingDockMetrics();
  const active = sectionFromPath(pathname);
  const railWidth = showLabels
    ? compact
      ? layout.compactNavigationRailWidth
      : layout.navigationRailWidth
    : spacing[56];
  const compactRailHeight = showLabels
    ? layout.compactNavigationRailHeight
    : layout.compactNavigationRailIconHeight;
  const compactRailTop = Math.max(0, (windowHeight - compactRailHeight) / 2);
  const railInset = Math.max(insets.left, spacing[8]);
  const iconSize = compact ? 20 : 22;

  const go = (href: (typeof ITEMS)[number]["href"]) => {
    router.navigate(href);
  };

  const docked = !floating;
  const wrapStyle = docked
    ? {
        width: railWidth + insets.left,
        paddingLeft: insets.left + spacing[4],
        paddingRight: spacing[4],
        paddingTop: insets.top + spacing[6],
        paddingBottom: insets.bottom + spacing[6],
        backgroundColor: palette.amoled ? palette.background : palette.surface,
      }
    : {
        position: "absolute" as const,
        left: railInset,
        top: compact ? compactRailTop : Math.max(insets.top, spacing[12]),
        bottom: compact ? undefined : Math.max(insets.bottom, spacing[12]),
        height: compact ? compactRailHeight : undefined,
        width: railWidth,
        padding: spacing[4],
        backgroundColor: palette.surfaceElevated,
        borderWidth: 1,
        borderColor: palette.borderStrong,
        borderRadius: radius["3xl"],
        zIndex: 20,
        ...shadows.level3,
      };

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.rail, wrapStyle]}
    >
      {ITEMS.map((item) => {
        const focused = active === item.section;
        const color = focused ? palette.accent : palette.textTertiary;
        return (
          <Pressable
            key={item.href}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            onPress={() => go(item.href)}
            style={[
              styles.item,
              {
                marginHorizontal: floating ? (compact ? spacing[2] : spacing[2]) : 0,
                marginTop: item.section === "bookmarks" ? ("auto" as const) : floating ? spacing[4] : 0,
                marginBottom: item.section === "settings" ? ("auto" as const) : floating ? spacing[4] : 0,
                borderRadius: floating ? radius.xl : 0,
                backgroundColor: floating && focused ? palette.accentSoft : "transparent",
              },
            ]}
          >
            <Ionicons name={item.icon} size={iconSize} color={color} />
            {showLabels ? (
              <NativeText
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  color,
                  fontFamily: "InterTight_500Medium",
                  fontSize: compact ? 10 : 11,
                  lineHeight: compact ? 14 : 15,
                }}
              >
                {item.label}
              </NativeText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function useRailSceneOffset() {
  const insets = useSafeAreaInsets();
  const showLabels = useSettingsStore((s) => s.showNavigationLabels);
  const { floating, compact, sideNavigation } = useFloatingDockMetrics();
  const railWidth = showLabels
    ? compact
      ? layout.compactNavigationRailWidth
      : layout.navigationRailWidth
    : spacing[56];
  const railInset = Math.max(insets.left, spacing[8]);
  if (!sideNavigation || !floating) return undefined;
  return { marginStart: railInset + railWidth + spacing[12] };
}

const styles = StyleSheet.create({
  rail: {
    alignItems: "stretch",
    justifyContent: "space-between",
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[8],
    overflow: "hidden",
  },
});
