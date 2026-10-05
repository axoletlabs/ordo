import React from "react";
import { Animated, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { useStateOpacity } from "../ui/StateLayer";

/** Full-bleed layers are clipped by the row's exact group silhouette. */
export function RowHighlight({ selected, hovered, pressed }: { selected: boolean; hovered: boolean; pressed: boolean }) {
  const { palette } = useTheme();
  const selection = useStateOpacity(+selected);
  const feedback = useStateOpacity(pressed ? 0.1 : hovered ? 0.08 : 0);
  return <>
    <Animated.View testID="material-row-selection" pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.secondaryContainer, opacity: selection }]} />
    <Animated.View testID="material-row-state-layer" pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.onSurface, opacity: feedback }]} />
  </>;
}
