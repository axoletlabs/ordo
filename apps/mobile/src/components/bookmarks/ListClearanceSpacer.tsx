/** Animated trailing scroll clearance for bookmark lists. The browsing (FAB)
 * and selection-bar clearances differ by a few pixels on zero-inset windows;
 * the spacer springs between them so toggling selection never snaps the end
 * of the list, and lays out directly under reduced motion. Rendered as the
 * list footer, it also keeps clearance below short and empty lists. */
import React from "react";
import Animated from "react-native-reanimated";
import { useSurfaceSize } from "../../hooks/use-surface-size";

export function ListClearanceSpacer({ height }: { height: number }) {
  const size = useSurfaceSize(Math.max(0, height), { initialHeight: 0 });
  return <Animated.View aria-hidden accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[{ flexShrink: 0 }, size]} />;
}
