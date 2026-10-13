import { useWindowDimensions } from "react-native";
import { responsiveLayout } from "../lib/responsive-layout";

/** Reactive layout traits shared by native rotation and web resizing. */
export function useResponsiveLayout() {
  const { width, height, scale, fontScale } = useWindowDimensions();
  return {
    width,
    height,
    scale,
    fontScale,
    ...responsiveLayout(width, height, fontScale),
  };
}
