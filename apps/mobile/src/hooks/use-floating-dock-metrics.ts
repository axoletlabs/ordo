/** Shared bottom clearance; the Material shell has no persistent navigation chrome. */
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../theme/tokens";
import { SELECTION_BAR_HEIGHT, useSelectionUiStore } from "./use-selection";

export function useFloatingDockMetrics() {
  const insets = useSafeAreaInsets();
  const selectionActive = useSelectionUiStore((s) => s.active);
  const bottom = Math.max(insets.bottom, spacing[16]);
  const selectionClearance = SELECTION_BAR_HEIGHT + bottom + spacing[16];
  const safeBottomClearance = bottom;
  return {
    floating: false, sideNavigation: false, visible: false,
    hideBottomNav: selectionActive, hideForKeyboard: false,
    bottom, height: 0, clearance: safeBottomClearance, selectionClearance,
    overlayClearance: selectionActive ? selectionClearance : safeBottomClearance,
    listOverlayClearance: selectionActive ? selectionClearance : insets.bottom + spacing[16] + 56 + spacing[8],
  };
}
