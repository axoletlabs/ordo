/**
 * Inset squircle behind a library row for hover, the open row, and multi-select.
 * A full-bleed rectangle reads as a hard slab; the curve stays visible against
 * the page because the fill is inset from the row edges.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { radius, spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

export function RowHighlight({ color }: { color: string }) {
  const { expressive } = useTheme();
  if (color === "transparent") return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.fill,
        { backgroundColor: color, borderRadius: expressive ? radius.xl : 0 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    left: spacing[0],
    right: spacing[0],
    top: spacing[0],
    bottom: spacing[0],
    borderRadius: radius.sm,
  },
});
