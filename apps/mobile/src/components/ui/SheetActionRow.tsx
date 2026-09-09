import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, type ButtonVariant } from "./Button";
import { ContextMenuItem } from "./ContextMenu";
import { spacing } from "../../theme/tokens";

export const sheetMenuStyles = StyleSheet.create({
  stack: { gap: spacing[8], marginTop: spacing[8] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[8], marginTop: spacing[12] },
  cancel: { marginTop: spacing[4] },
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
  onCancel: () => void;
  cancelLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  confirmVariant?: ButtonVariant;
}) {
  return (
    <View style={sheetMenuStyles.row}>
      <Button
        label={cancelLabel}
        variant="ghost"
        onPress={onCancel}
        disabled={cancelDisabled}
        style={{ flex: 1 }}
      />
      <Button
        label={confirmLabel}
        variant={confirmVariant}
        onPress={onConfirm}
        loading={loading}
        disabled={confirmDisabled}
        style={{ flex: 1 }}
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
