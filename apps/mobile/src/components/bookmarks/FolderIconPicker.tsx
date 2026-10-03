import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { PressableScale } from "../ui/PressableScale";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { FOLDER_ICONS, type FolderIcon } from "@ordo/shared";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PickerField } from "../ui/PickerField";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import { radius, spacing } from "../../theme/tokens";

export function FolderIconPicker({
  value,
  onChange,
  onOpenChange,
}: {
  value: FolderIcon;
  onChange: (icon: FolderIcon) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => { setOpen(false); onOpenChange?.(false); };

  return (
    <>
    <PickerField label="Icon" value={value.replace(/-outline$/, "").replace(/-/g, " ").replace(/^./, (letter) => letter.toUpperCase())}
      icon={value} onPress={() => { dismissKeyboard(); setOpen(true); onOpenChange?.(true); }} />
    <FloatingPanel visible={open} onDismiss={close}>
      <PanelHeader title="Folder icon" onClose={close} />
      <FolderIconGrid value={value} onChange={(icon) => { onChange(icon); close(); }} />
    </FloatingPanel>
    </>
  );
}

export function FolderIconGrid({ value, onChange }: { value: FolderIcon; onChange: (icon: FolderIcon) => void }) {
  const { palette, expressive } = useTheme();
  return <View accessibilityRole="radiogroup" accessibilityLabel="Folder icon" style={styles.grid}>
      {FOLDER_ICONS.map((icon) => {
        const selected = icon === value;
        return (
          <PressableScale
            key={icon}
            accessibilityRole="radio"
            accessibilityLabel={icon.replace(/-outline$/, "").replace(/-/g, " ")}
            accessibilityState={{ checked: selected }}
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
      </View>
  ;
}

const styles = StyleSheet.create({
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
