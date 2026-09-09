import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  const { palette, shadows } = useTheme();
  if (actions.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={[styles.layer, { maxWidth, paddingBottom: bottom }]}>
        <View
          style={[
            styles.bar,
            {
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.border,
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
                style={[styles.action, muted && styles.disabled]}
              >
                <Ionicons name={action.icon} size={22} color={color} />
                <Text variant="caption" style={{ color }} numberOfLines={1}>
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
    paddingHorizontal: spacing[16],
  },
  bar: {
    minHeight: SELECTION_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
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
