/**
 * One-time console-delivery hint. Shown only when the server has no SMTP
 * (codes print in the process log). Hidden after dismiss, and never shown
 * when mail is actually being sent.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { useSettingsStore } from "../../store/settings";
import { radius, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { iconGlyphStyle } from "../../theme/icon-glyph";

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
        <Ionicons name="terminal-outline" size={24} color={palette.onPrimaryContainer} style={iconGlyphStyle(24)} />
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
    gap: spacing[8],
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing[16],
  },
  spaced: { marginBottom: spacing[16] },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: spacing[4] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
  },
  dismiss: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing[8] },
});
