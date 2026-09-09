import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type ButtonVariant } from "./Button";
import { PanelHeader } from "./PanelHeader";
import { FloatingPanel } from "./FloatingPanel";
import { ContextMenuItem } from "./ContextMenu";
import { spacing } from "../../theme/tokens";

export function ConfirmDialog({
  visible,
  onDismiss,
  icon,
  tone = "danger",
  title,
  message,
  children,
  confirmLabel,
  confirmVariant,
  onConfirm,
  loading = false,
  cancelLabel = "Cancel",
  dismissible = true,
}: {
  visible: boolean;
  onDismiss: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "danger" | "accent";
  title: string;
  message: string;
  children?: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  loading?: boolean;
  cancelLabel?: string;
  dismissible?: boolean;
}) {
  const canDismiss = dismissible && !loading;
  const danger = (confirmVariant ?? (tone === "danger" ? "danger" : "primary")) === "danger";

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={onDismiss}
      maxWidth={360}
      dismissible={canDismiss}
    >
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PanelHeader title={title} subtitle={message} titleVariant="title2" style={styles.header} />
        {children ? <View style={styles.extra}>{children}</View> : null}
        <ContextMenuItem
          icon={icon}
          label={confirmLabel}
          tone={danger ? "danger" : undefined}
          busy={loading}
          onPress={onConfirm}
        />
        <ContextMenuItem label={cancelLabel} disabled={loading} onPress={onDismiss} />
      </ScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing[4] },
  extra: { marginBottom: spacing[8], paddingHorizontal: spacing[12] },
});
