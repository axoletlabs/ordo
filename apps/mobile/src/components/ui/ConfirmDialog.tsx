import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, type ButtonVariant } from "./Button";
import { PanelHeader } from "./PanelHeader";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

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
  const { palette, shadows } = useTheme();
  const canDismiss = dismissible && !loading;
  const iconBg = tone === "danger" ? palette.dangerSoft : palette.accentSoft;
  const iconColor = tone === "danger" ? palette.danger : palette.accent;
  const variant = confirmVariant ?? (tone === "danger" ? "danger" : "primary");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={canDismiss ? onDismiss : () => {}}
    >
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]}
          disabled={!canDismiss}
          onPress={onDismiss}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.border,
              ...shadows.level3,
            },
          ]}
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
                block
                disabled={loading}
                onPress={onDismiss}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[20],
  },
  dialog: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "88%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius["3xl"],
    paddingHorizontal: spacing[16],
    paddingTop: spacing[16],
    paddingBottom: spacing[12],
  },
  header: { marginBottom: 0 },
  extra: { marginTop: spacing[12] },
  actions: { gap: spacing[4], marginTop: spacing[12] },
});
