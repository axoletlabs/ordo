import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { AppIcon } from "../ui/PinIcon";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { ButtonGroup } from "../ui/ButtonGroup";
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
  const { width } = useWindowDimensions();
  const column = useColumnPadding(maxWidth);
  const itemWidth = Math.max(48, (Math.min(width, maxWidth) - column.left - column.right - 16 - Math.max(0, actions.length - 1) * 8) / Math.max(1, actions.length));
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
          <ButtonGroup itemWidth={itemWidth} visualInset={0} gap={8}>
          {actions.map((action) => {
            const color = action.danger ? palette.onErrorContainer : palette.onSecondaryContainer;
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
                 stateLayerColor={color} shape={{ rest: 24, pressed: expressive ? radius.md : 24 }}
                 hitSlop={4}
                 style={[styles.action, { borderRadius: 24, backgroundColor: action.danger ? palette.errorContainer : palette.secondaryContainer }, muted && styles.disabled]}
              >
                <AppIcon name={action.icon} size={22} color={color} />
                <Text variant="labelSmall" style={{ color }} numberOfLines={1}>
                  {action.label}
                </Text>
              </PressableScale>
            );
          })}
          </ButtonGroup>
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
    paddingHorizontal: spacing[8],
  },
  action: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
    minHeight: 48,
  },
  disabled: { opacity: 0.4 },
});
