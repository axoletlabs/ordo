/**
 * Column padding for the navigation scene.
 *
 * Landscape and wide web put a side rail over the leading edge. The scene
 * is the width beside that rail. Callers used to measure the window, which
 * invents margin the scene does not have and lets a trailing cutout cover
 * the column.
 */
import { useWindowDimensions } from "react-native";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettingsStore } from "../store/settings";
import {
  SCREEN_RAIL,
  columnContentInset,
  sceneEdgeInsets,
  sceneLeadingChrome,
} from "../theme/alignment";
import { layout, spacing } from "../theme/tokens";
import { useResponsiveLayout } from "./use-responsive-layout";

/** `scene` sits beside the rail. `window` is a full-window overlay. `parent` is already inside a padded column. */
export type ColumnAlign = "scene" | "window" | "parent";

export function navigationRailWidth(showLabels: boolean, compact: boolean): number {
  return showLabels
    ? compact
      ? layout.compactNavigationRailWidth
      : layout.navigationRailWidth
    : spacing[56];
}

export function useSceneColumnInsets(alignTo: ColumnAlign = "scene") {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { useSideNavigation } = useResponsiveLayout();
  const segments = useSegments();
  const navigationStyle = useSettingsStore((s) => s.navigationStyle);
  const showLabels = useSettingsStore((s) => s.showNavigationLabels);
  const floating = navigationStyle !== "docked";
  const compact = (navigationStyle as string) === "compactFloating";
  // The rail is mounted only on the authenticated app stack. Landscape auth
  // screens must not leave a gap for a rail that is not there.
  const railMounted = segments[0] === "(app)";
  const respectRail = alignTo === "scene" && useSideNavigation && railMounted;
  const lead = sceneLeadingChrome({
    sideNavigation: respectRail,
    floating,
    railWidth: navigationRailWidth(showLabels, compact),
    safeLeading: insets.left,
  });
  const sceneWidth = Math.max(0, width - lead);
  const edges = sceneEdgeInsets(respectRail, insets.left, insets.right);

  return {
    sceneWidth,
    lead,
    leading(maxWidth: number) {
      return columnContentInset(edges.leading, sceneWidth, maxWidth);
    },
    trailing(maxWidth: number) {
      return columnContentInset(edges.trailing, sceneWidth, maxWidth);
    },
  };
}

export function useColumnPadding(maxWidth: number, alignTo: ColumnAlign = "scene") {
  const scene = useSceneColumnInsets(alignTo);
  if (alignTo === "parent") {
    return { left: SCREEN_RAIL, right: SCREEN_RAIL, sceneWidth: scene.sceneWidth, lead: scene.lead };
  }
  return {
    left: scene.leading(maxWidth),
    right: scene.trailing(maxWidth),
    sceneWidth: scene.sceneWidth,
    lead: scene.lead,
  };
}
