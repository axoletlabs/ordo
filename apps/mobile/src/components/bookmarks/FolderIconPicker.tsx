import React from "react";
import { StyleSheet } from "react-native";
import { PressableScale } from "../ui/PressableScale";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { FOLDER_ICONS, type FolderIcon } from "@ordo/shared";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { radius, spacing } from "../../theme/tokens";

export function FolderIconPicker({
  value,
  onChange,
}: {
  value: FolderIcon;
  onChange: (icon: FolderIcon) => void;
}) {
  const { palette, expressive } = useTheme();

  return (
    <ThemedScrollView
      style={styles.scroll}
      contentContainerStyle={styles.grid}
      nestedScrollEnabled
    >
      {FOLDER_ICONS.map((icon) => {
        const selected = icon === value;
        return (
          <PressableScale
            key={icon}
            accessibilityRole="button"
            accessibilityLabel={icon.replace(/-outline$/, "").replace(/-/g, " ")}
            accessibilityState={{ selected }}
            onPress={() => {
              haptics.selection();
              onChange(icon);
            }}
            shape={{ rest: selected && expressive ? radius.md : 24, pressed: expressive ? radius.sm : 24 }}
            style={[
              styles.icon,
              {
                backgroundColor: selected ? palette.secondaryContainer : palette.surfaceContainerHigh,
                borderColor: "transparent",
              },
            ]}
          >
            <Ionicons name={icon} size={24} color={selected ? palette.onSecondaryContainer : palette.onSurfaceVariant} />
          </PressableScale>
        );
      })}
    </ThemedScrollView>
  );
}

const styles = StyleSheet.create({
  // Three 42px rows with two 8px gaps; remaining icons scroll vertically.
  scroll: { maxHeight: 160 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[8] },
  icon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
});
