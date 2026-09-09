import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, type ButtonVariant } from "./Button";
import { PanelHeader } from "./PanelHeader";
import { FloatingPanel } from "./FloatingPanel";
import { useTheme } from "../../theme/ThemeProvider";
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
  const { palette } = useTheme();
  const canDismiss = dismissible && !loading;
  const iconBg = tone === "danger" ? palette.dangerSoft : palette.accentSoft;
  const iconColor = tone === "danger" ? palette.danger : palette.accent;
  const variant = confirmVariant ?? (tone === "danger" ? "danger" : "primary");

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
        <PanelHeader
          icon={icon}
          iconColor={iconColor}
          iconBackground={iconBg}
          title={title}
          subtitle={message}
          titleVariant="title2"
          style={styles.header}
        />
        {children ? <View style={styles.extra}>{children}</View> : null}
        <View style={styles.actions}>
          <Button
            label={confirmLabel}
            variant={variant}
            size="lg"
            block
            loading={loading}
            onPress={onConfirm}
          />
          <Button
            label={cancelLabel}
            variant="ghost"
            size="lg"
            block
            disabled={loading}
            onPress={onDismiss}
          />
        </View>
      </ScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 0 },
  extra: { marginTop: spacing[12] },
  actions: { gap: spacing[4], marginTop: spacing[12] },
});
