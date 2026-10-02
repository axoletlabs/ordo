/**
 * Checkbox locked to the first footnote line.
 *
 * The square matches that line's box, so a wrapping label does not pull
 * the mark to the vertical center of the paragraph.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { CHECK_GLYPH, FOOTNOTE_LINE_BOX } from "../../theme/type-metrics";
import { spacing } from "../../theme/tokens";

export function CheckLine({
  checked,
  label,
  onPress,
  children,
}: {
  checked: boolean;
  /** Accessible name, and the visible label when `children` is omitted. */
  label: string;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.row}
    >
      <View style={styles.box} pointerEvents="none">
        <Ionicons
          name={checked ? "checkbox" : "square-outline"}
          size={CHECK_GLYPH}
          color={checked ? palette.accent : palette.textTertiary}
          style={iconGlyphStyle(CHECK_GLYPH)}
        />
      </View>
      <Text variant="footnote" style={styles.label}>
        {children ?? label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[8],
    alignSelf: "stretch",
    minHeight: 48,
    paddingVertical: spacing[12],
  },
  box: {
    width: FOOTNOTE_LINE_BOX,
    height: FOOTNOTE_LINE_BOX,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    flex: 1,
    includeFontPadding: false,
  },
});
