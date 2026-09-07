import React from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FOLDER_ICONS, type FolderIcon } from "@ordo/shared";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

export function FolderIconPicker({
  value,
  onChange,
}: {
  value: FolderIcon;
  onChange: (icon: FolderIcon) => void;
}) {
  const { palette } = useTheme();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      {FOLDER_ICONS.map((icon) => {
        const selected = icon === value;
        return (
          <Pressable
            key={icon}
            accessibilityRole="button"
            accessibilityLabel={icon.replace(/-outline$/, "").replace(/-/g, " ")}
            accessibilityState={{ selected }}
            onPress={() => {
              haptics.selection();
              onChange(icon);
            }}
            style={({ pressed }) => [
              styles.icon,
              {
                backgroundColor: selected ? palette.accentSoft : palette.surfaceSecondary,
                borderColor: selected ? palette.accent : palette.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name={icon} size={21} color={selected ? palette.accent : palette.textSecondary} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Three 42px rows with two 8px gaps; remaining icons scroll vertically.
  scroll: { maxHeight: 142 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[8] },
  icon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
});
