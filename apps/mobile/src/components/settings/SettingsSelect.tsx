import React from "react";
import { Keyboard, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../ui/Text";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import type { MenuAnchorRect } from "../../lib/menu-anchor";

export interface SettingsSelectOption<T extends string> {
  value: T;
  label: string;
  shortLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T;
  options: readonly SettingsSelectOption<T>[];
  onChange: (value: T) => void;
  title: string;
}) {
  const { palette } = useTheme();
  const anchorRef = React.useRef<View>(null);
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<MenuAnchorRect | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const show = () => {
    haptics.selection();
    Keyboard.dismiss();
    anchorRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
      setOpen(true);
    });
  };

  const choose = (next: T) => {
    haptics.selection();
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <View ref={anchorRef} collapsable={false} style={styles.anchor}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${selected?.label ?? value}`}
          accessibilityState={{ expanded: open }}
          onPress={show}
          hitSlop={{ top: 4, bottom: 4 }}
          style={({ pressed }) => [
            styles.trigger,
            { borderColor: palette.borderStrong, backgroundColor: palette.surfaceSecondary },
            pressed && styles.pressed,
          ]}
        >
          {selected?.icon ? (
            <Ionicons name={selected.icon} size={16} color={palette.textTertiary} style={styles.triggerIcon} />
          ) : null}
          <Text variant="subhead" numberOfLines={1} ellipsizeMode="tail" style={styles.triggerLabel}>
            {selected?.shortLabel ?? selected?.label ?? value}
          </Text>
          <Ionicons name="chevron-down" size={14} color={palette.textTertiary} style={styles.triggerChevron} />
        </Pressable>
      </View>

      <ContextMenu visible={open} onDismiss={() => setOpen(false)} anchor={anchor} width={300}>
        {options.map((option) => (
          <ContextMenuItem
            key={option.value}
            icon={option.icon}
            label={option.label}
            selected={option.value === value}
            onPress={() => choose(option.value)}
          />
        ))}
      </ContextMenu>
    </>
  );
}

const styles = StyleSheet.create({
  anchor: {
    width: layout.settingsControlWidth,
    minWidth: layout.settingsControlWidth,
    maxWidth: layout.settingsControlWidth,
    flexGrow: 0,
    flexShrink: 0,
  },
  trigger: {
    width: layout.settingsControlWidth,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing[6],
    paddingHorizontal: spacing[10],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  triggerIcon: { flexShrink: 0 },
  triggerChevron: { flexShrink: 0 },
  triggerLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  pressed: { opacity: 0.72 },
});
