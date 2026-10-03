import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { Button, type ButtonVariant } from "./Button";
import { ContextMenuItem } from "./ContextMenu";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import { spacing } from "../../theme/tokens";

export const sheetMenuStyles = StyleSheet.create({
  stack: { gap: spacing[8], marginTop: spacing[8] },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "flex-end",
    gap: spacing[8],
    marginTop: spacing[24],
  },
  action: {
    flexShrink: 1,
    minWidth: 0,
  },
  cancel: { marginTop: spacing[8] },
});

/** Compact Cancel + confirm pair for form panels. */
export function PanelActions({
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = "Cancel",
  loading = false,
  confirmDisabled,
  cancelDisabled,
  confirmVariant = "primary",
}: {
  confirmLabel: string;
  onConfirm: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  confirmVariant?: ButtonVariant;
}) {
  return (
    <View style={sheetMenuStyles.row}>
      {onCancel ? <Button
        label={cancelLabel}
        variant="ghost"
        onPress={() => {
          dismissKeyboard();
          onCancel();
        }}
        disabled={cancelDisabled}
        style={sheetMenuStyles.action}
      /> : null}
      <Button
        label={confirmLabel}
        variant={confirmVariant}
        onPress={() => {
          dismissKeyboard();
          onConfirm();
        }}
        loading={loading}
        disabled={confirmDisabled}
        style={sheetMenuStyles.action}
      />
    </View>
  );
}

/** Shrink-wraps action rows to the longest label and centers that column. */
export function SheetMenu({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.menu}>
      <View>{children}</View>
    </View>
  );
}

export function SheetActionRow({
  icon,
  label,
  tone,
  trailing,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: "danger";
  trailing?: React.ReactNode;
  divider?: boolean;
  onPress: () => void;
}) {
  return (
    <ContextMenuItem icon={icon} label={label} tone={tone} trailing={trailing} onPress={onPress} />
  );
}

const styles = StyleSheet.create({
  menu: { width: "100%", alignItems: "center" },
});
