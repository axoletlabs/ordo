/**
 * Inset squircle behind a library row for hover, the open row, and multi-select.
 * A full-bleed rectangle reads as a hard slab; the curve stays visible against
 * the page because the fill is inset from the row edges.
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { radius, spacing } from "../../theme/tokens";

export function RowHighlight({ color }: { color: string }) {
  if (color === "transparent") return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.fill,
        { backgroundColor: color },
        Platform.OS === "web" ? styles.webSquircle : styles.nativeSquircle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    left: spacing[8],
    right: spacing[8],
    top: spacing[4],
    bottom: spacing[4],
    borderRadius: radius["3xl"],
  },
  nativeSquircle: {
    borderCurve: "continuous",
  },
  webSquircle: {
    cornerShape: "squircle",
  } as object,
});
