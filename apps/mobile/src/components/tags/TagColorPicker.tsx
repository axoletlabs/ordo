/** Grid of curated tag colors (semantic keys from @ordo/shared). */
import React from "react";
import { StyleSheet, View } from "react-native";
import { PressableScale } from "../ui/PressableScale";
import { MaterialIcon } from "../ui/MaterialIcon";
import { TAG_COLORS, type TagColor } from "@ordo/shared";
import { haptics } from "../../lib/haptics";
import { tagColorValue } from "../../lib/tag-colors";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

export function TagColorPicker({
  value,
  onChange,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
}) {
  const { palette, expressive } = useTheme();

  return (
    <View style={styles.grid}>
      {TAG_COLORS.map((color) => {
        const selected = color === value;
        return (
          <PressableScale
            key={color}
            accessibilityRole="button"
            accessibilityLabel={color}
            accessibilityState={{ selected }}
            onPress={() => {
              haptics.selection();
              onChange(color);
            }}
            shape={{ rest: selected && expressive ? radius.md : 24, pressed: expressive ? radius.sm : 24 }}
            style={[
              styles.swatch,
              {
                borderColor: selected ? palette.primary : "transparent",
                backgroundColor: palette.surfaceContainerHigh,
              },
            ]}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: tagColorValue(color).dot,
                  borderColor: "transparent",
                },
              ]}
            />
            {selected ? <MaterialIcon name="checkmark" size={16} color={palette.onSurface} style={{ position: "absolute", bottom: 2, right: 2 }} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[8] },
  swatch: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: radius.lg,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
