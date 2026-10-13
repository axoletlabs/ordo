import React, { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useRadioGroupKeys } from "../../hooks/use-radio-group-keys";
import { ListPressable } from "../ui/ListPressable";
import { ThemedFlatList } from "../ui/ThemedScrollView";
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
    <FloatingPanel visible={open} onDismiss={close} scrollBody={false}>
      <PanelHeader title="Folder icon" onClose={close} />
       <FolderIconGrid value={value} onChange={onChange} onConfirm={close} />
    </FloatingPanel>
    </>
  );
}

export function FolderIconGrid({ value, onChange, onConfirm }: { value: FolderIcon; onChange: (icon: FolderIcon) => void; onConfirm?: () => void }) {
  const { palette, expressive } = useTheme();
   const keys = useRadioGroupKeys(FOLDER_ICONS, onChange, 5);
   return <View {...keys} accessibilityRole="radiogroup" accessibilityLabel="Folder icon" style={{ flexShrink: 1 }}>
      <ThemedFlatList data={FOLDER_ICONS} numColumns={5} keyExtractor={(icon) => icon}
         extraData={value} initialNumToRender={Platform.OS === "web" ? FOLDER_ICONS.length : 20} maxToRenderPerBatch={20} windowSize={3}
        style={{ maxHeight: 336, flexShrink: 1 }} keyboardShouldPersistTaps="handled"
        renderItem={({ item: icon }) => {
        const selected = icon === value;
        return (
          <View style={styles.cell}><ListPressable
            accessibilityRole="radio"
            accessibilityLabel={icon.replace(/-outline$/, "").replace(/-/g, " ")}
            accessibilityState={{ checked: selected }}
            {...(Platform.OS === "web" ? { tabIndex: selected ? 0 : -1 } : {})}
            onPress={() => {
              haptics.selection();
              onChange(icon);
              onConfirm?.();
            }}
            style={[
              styles.icon,
              {
                backgroundColor: selected ? palette.secondaryContainer : palette.surfaceContainerHigh,
                borderColor: "transparent",
                borderRadius: selected && expressive ? radius.md : radius.full,
              },
            ]}
          >
            <Ionicons name={icon} size={24} color={selected ? palette.onSecondaryContainer : palette.onSurfaceVariant} />
          </ListPressable></View>
        );
      }} />
      </View>
  ;
}

const styles = StyleSheet.create({
  cell: { flex: 1, minWidth: 48, alignItems: "center", paddingVertical: spacing[4] },
  icon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
});
