/**
 * Seats for the small list glyphs (reminder, article, lock, pin, website-open).
 * Supporting metadata shares a centered 16px cell, not a trailing title badge.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

export const ROW_STATUS_ICON_SIZE = 14;
export const ROW_STATUS_SLOT = 16;

export function RowStatusSlot({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.slot, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  slot: {
    width: ROW_STATUS_SLOT,
    height: ROW_STATUS_SLOT,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
