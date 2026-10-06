/**
 * Inset-less feedback behind a library row for hover/press and multi-select.
 * The hover alpha is baked into the color: a resting sub-1 opacity distorts
 * the row's radius clip (seen as squared-off ends on grouped rows).
 */
import React from "react";
import { Animated, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { alphaTint } from "../../theme/state-layer";
import { useStateVisibility } from "../ui/StateLayer";

export function RowHighlight({ selected, hovered, pressed }: { selected: boolean; hovered: boolean; pressed: boolean }) {
  const { palette } = useTheme();
  const selection = useStateVisibility(selected);
  const feedback = useStateVisibility(pressed || hovered);
  return <>
    <Animated.View testID="material-row-selection" pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.secondaryContainer, opacity: selection }]} />
    <Animated.View testID="material-row-state-layer" pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, { backgroundColor: alphaTint(palette.onSurface, pressed ? 0.1 : 0.08), opacity: feedback }]} />
  </>;
}
