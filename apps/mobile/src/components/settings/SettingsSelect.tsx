import React from "react";
import { Keyboard, StyleSheet, View, useWindowDimensions } from "react-native";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { Text } from "../ui/Text";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { PressableScale } from "../ui/PressableScale";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { iconGlyphStyle } from "../../theme/icon-glyph";
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
  const { width } = useWindowDimensions();
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
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <View ref={anchorRef} collapsable={false} style={[styles.anchor, { width: width < 380 ? 112 : layout.settingsControlWidth }]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${selected?.label ?? value}`}
          accessibilityState={{ expanded: open }}
          aria-haspopup="menu"
          stateLayerColor={palette.onSecondaryContainer}
          onPress={show}
          hitSlop={{ top: 4, bottom: 4 }}
          style={[
            styles.trigger,
            { borderColor: "transparent", backgroundColor: palette.secondaryContainer },
          ]}
        >
          {selected?.icon && width >= 380 ? (
            <Ionicons
              name={selected.icon}
              size={16}
              color={palette.onSecondaryContainer}
              style={[styles.triggerIcon, iconGlyphStyle(16)]}
            />
          ) : null}
          <Text variant="labelLarge" numberOfLines={1} ellipsizeMode="tail" style={[styles.triggerLabel, { color: palette.onSecondaryContainer }]}>
            {selected?.shortLabel ?? selected?.label ?? value}
          </Text>
          <Ionicons
            name="chevron-down"
            size={14}
            color={palette.onSecondaryContainer}
            style={[styles.triggerChevron, iconGlyphStyle(14)]}
          />
        </PressableScale>
      </View>

      <ContextMenu visible={open} onDismiss={() => setOpen(false)} anchor={anchor} width={300}>
        {options.map((option) => (
          <ContextMenuItem
            key={option.value}
            icon={option.icon}
            label={option.label}
            selected={option.value === value}
            selectionRole="menuitemradio"
            onPress={() => choose(option.value)}
          />
        ))}
      </ContextMenu>
    </>
  );
}

const styles = StyleSheet.create({
  anchor: {
    flexGrow: 0,
    flexShrink: 0,
  },
  trigger: {
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing[6],
    paddingHorizontal: spacing[10],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    overflow: "hidden",
  },
  triggerIcon: { flexShrink: 0 },
  triggerChevron: { flexShrink: 0 },
  triggerLabel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    includeFontPadding: false,
  },
});
