/**
 * Small color-aware tag chip. Selected state inverts to a filled pill for
 * filter controls; the leading dot always carries the tag color.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { TagColor } from "@ordo/shared";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { tagColorValue, tagFg } from "../../lib/tag-colors";

export interface TagChipProps {
  name: string;
  color: TagColor;
  selected?: boolean;
  count?: number;
  compact?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export const TagChip = React.memo(function TagChip({
  name,
  color,
  selected = false,
  count,
  compact = false,
  onPress,
  accessibilityLabel,
}: TagChipProps) {
  const { palette } = useTheme();
  const value = tagColorValue(color);
  const fg = tagFg(color, palette.mode === "dark");

  const body = (
    <View
      style={[
        styles.chip,
        compact ? styles.compact : null,
        {
          backgroundColor: selected ? value.dot : value.fill,
          borderColor: selected ? value.dot : "transparent",
        },
      ]}
    >
      {!selected ? <View style={[styles.dot, { backgroundColor: value.dot }]} /> : null}
      <Text
        variant={compact ? "caption" : "footnote"}
        color="primary"
        numberOfLines={1}
        style={[styles.label, { color: selected ? "#FFFFFF" : fg }]}
      >
        {name}
      </Text>
      {typeof count === "number" ? (
        <Text
          variant="caption"
          color="primary"
          style={{ color: selected ? "rgba(255,255,255,0.8)" : fg, opacity: 0.8 }}
        >
          {count}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      accessibilityState={{ selected }}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      hitSlop={8}
      style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
    >
      {body}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[6],
    paddingHorizontal: spacing[10],
    paddingVertical: spacing[4],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
    maxWidth: 200,
  },
  compact: {
    paddingHorizontal: spacing[8],
    paddingVertical: 2,
    maxWidth: 140,
  },
  dot: { width: 7, height: 7, borderRadius: 9999 },
  label: { flexShrink: 1 },
});
