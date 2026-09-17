/**
 * One-time console-delivery hint. Shown only when the server has no SMTP
 * (codes print in the process log). Hidden after dismiss, and never shown
 * when mail is actually being sent.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { useSettingsStore } from "../../store/settings";
import { radius, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";

export function OtpDeliveryHint({
  smtpConfigured,
  compact,
}: {
  smtpConfigured: boolean | undefined;
  /** Skip the trailing gap when the parent already spaces children. */
  compact?: boolean;
}) {
  const { palette } = useTheme();
  const dismissed = useSettingsStore((s) => s.consoleOtpTipDismissed);
  const dismiss = useSettingsStore((s) => s.dismissConsoleOtpTip);

  if (smtpConfigured !== false || dismissed) return null;

  return (
    <View
      style={[
        styles.tip,
        !compact && styles.spaced,
        {
          backgroundColor: palette.surfaceSecondary,
          borderColor: palette.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel="One-time codes are printed in the server console"
    >
      <View style={[styles.icon, { backgroundColor: palette.accentSoft }]}>
        <Ionicons name="terminal-outline" size={15} color={palette.accent} />
      </View>
      <View style={styles.body}>
        <View style={styles.header}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            Check the server console
          </Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Dismiss console OTP tip"
            hitSlop={8}
            onPress={() => {
              haptics.light();
              dismiss();
            }}
            style={styles.dismiss}
          >
            <Text variant="label" color="accent">
              Got it
            </Text>
          </PressableScale>
        </View>
        <Text variant="footnote" color="secondary">
          Codes print in the server process until SMTP is configured.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[10],
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing[12],
  },
  spaced: { marginBottom: spacing[16] },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  body: { flex: 1, gap: spacing[4] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
  },
  dismiss: { paddingVertical: spacing[2], paddingHorizontal: spacing[4] },
});
