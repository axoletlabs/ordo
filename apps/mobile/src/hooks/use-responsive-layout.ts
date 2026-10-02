import { Platform, useWindowDimensions } from "react-native";

const TABLET_SHORTEST_SIDE = 600;
const WIDE_BREAKPOINT = 600;
const DETAIL_PANE_BREAKPOINT = 840;

/** Reactive layout traits shared by native rotation and web resizing. */
export function useResponsiveLayout() {
  const { width, height, scale, fontScale } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = Math.min(width, height) >= TABLET_SHORTEST_SIDE;
  const isWide = width >= WIDE_BREAKPOINT;
  const isDesktop = Platform.OS === "web" && width >= DETAIL_PANE_BREAKPOINT;

  return {
    width,
    height,
    scale,
    fontScale,
    isLandscape,
    isTablet,
    isWide,
    isDesktop,
    hasDetailPane: width >= DETAIL_PANE_BREAKPOINT,
    useSideNavigation: false,
  };
}
