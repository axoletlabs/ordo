import React from "react";
import { StyleSheet, View } from "react-native";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { AppIcon } from "../ui/PinIcon";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { layout, radius, spacing } from "../../theme/tokens";
import { SELECTION_BAR_HEIGHT } from "../../hooks/use-selection";

export interface SelectionAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function SelectionActionBar({
  actions,
  bottom,
  maxWidth = layout.maxContentWidth,
}: {
  actions: readonly SelectionAction[];
  bottom: number;
  maxWidth?: number;
}) {
  const { palette, shadows, expressive } = useTheme();
  const column = useColumnPadding(maxWidth);
  if (actions.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={[
          styles.layer,
          {
            maxWidth,
            paddingBottom: bottom,
            paddingLeft: column.left,
            paddingRight: column.right,
          },
        ]}
      >
        <View
          style={[
            styles.bar,
            {
               backgroundColor: palette.surfaceContainerHigh,
               borderRadius: expressive ? radius["3xl"] : radius.full,
              ...shadows.level2,
            },
          ]}
        >
          {actions.map((action) => {
            const color = action.danger ? palette.danger : palette.text;
            const muted = action.disabled;
            return (
              <PressableScale
                key={action.key}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                disabled={muted}
                onPress={() => {
                  if (muted) return;
                  haptics.light();
                  action.onPress();
                }}
                 style={[styles.action, { borderRadius: radius.full }, muted && styles.disabled]}
              >
                <AppIcon name={action.icon} size={22} color={color} />
                <Text variant="label" style={{ color }} numberOfLines={1}>
                  {action.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    justifyContent: "flex-end",
  },
  bar: {
    minHeight: SELECTION_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 0,
    borderRadius: radius["2xl"],
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[4],
  },
  action: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
    minHeight: 48,
  },
  disabled: { opacity: 0.4 },
});
