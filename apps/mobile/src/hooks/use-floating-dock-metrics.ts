import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettingsStore } from "../store/settings";
import { listScrollOverlayClearance } from "../theme/scrollbar";
import { layout, spacing } from "../theme/tokens";
import { useKeyboardVisible } from "./use-keyboard-visible";
import { useResponsiveLayout } from "./use-responsive-layout";
import { SELECTION_BAR_HEIGHT, useSelectionUiStore } from "./use-selection";

const FLOATING_DOCK_PATHS = new Set(["/", "/search", "/settings"]);

export function useFloatingDockMetrics() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { useSideNavigation, width: windowWidth, height: windowHeight } =
    useResponsiveLayout();
  const navigationStyle = useSettingsStore((s) => s.navigationStyle);
  const selectionActive = useSelectionUiStore((s) => s.active);
  const keyboardVisible = useKeyboardVisible();
  const floating = navigationStyle !== "docked";
  const compact = navigationStyle === "compactFloating";
  const showLabels = useSettingsStore((s) => s.showNavigationLabels);
  const bottom = Math.max(insets.bottom, spacing[12]);
  const height = (showLabels ? layout.tabBarHeight : layout.touchTargetMin) + spacing[8];
  const clearance = bottom + height + spacing[16];
  const hideBottomNav = selectionActive && !useSideNavigation;
  // Hide-on-keyboard only slides the inner tab items. Our floating chrome is a
  // separate pill, so it must hide too or it sits empty above the keyboard.
  const hideForKeyboard = keyboardVisible && floating && !useSideNavigation;
  const navigationVisible = FLOATING_DOCK_PATHS.has(pathname) && !hideBottomNav;
  const visible = floating && !useSideNavigation && navigationVisible;
  const dockedClearance =
    (showLabels ? layout.tabBarHeight : layout.touchTargetMin) + insets.bottom + spacing[16];
  const selectionClearance = SELECTION_BAR_HEIGHT + bottom + spacing[16];
  const safeBottomClearance = insets.bottom + spacing[16];

  return {
    floating,
    compact,
    sideNavigation: useSideNavigation,
    windowWidth,
    windowHeight,
    visible,
    hideBottomNav,
    hideForKeyboard,
    bottom,
    height,
    clearance,
    selectionClearance,
    overlayClearance: hideBottomNav
      ? selectionClearance
      : navigationVisible && !useSideNavigation
        ? floating
          ? clearance
          : dockedClearance
        : safeBottomClearance,
    listOverlayClearance: listScrollOverlayClearance({
      hideBottomNav,
      selectionClearance,
      floatingDockVisible: visible,
      floatingDockClearance: clearance,
      dockedTabScene: FLOATING_DOCK_PATHS.has(pathname) && !useSideNavigation,
      safeBottomClearance,
    }),
  };
}
