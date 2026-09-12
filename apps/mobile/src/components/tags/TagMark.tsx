/**
 * Color-aware tag glyph. Library rows use the same 36×36 framed slot as
 * folders and favicons; pickers use a compact mark in place of a raw dot.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TagColor } from "@ordo/shared";
import { tagColorValue } from "../../lib/tag-colors";
import { radius } from "../../theme/tokens";

export function TagMark({
  color,
  size = "row",
  icon = "pricetag",
}: {
  color: TagColor;
  size?: "row" | "compact";
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const value = tagColorValue(color);
  const row = size === "row";

  return (
    <View
      style={[
        styles.frame,
        row ? styles.row : styles.compact,
        { backgroundColor: value.fill, borderColor: value.dot },
      ]}
    >
      <Ionicons name={icon} size={row ? 16 : 11} color={value.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  row: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
  },
  compact: {
    width: 22,
    height: 22,
    borderRadius: radius.xs,
  },
});
