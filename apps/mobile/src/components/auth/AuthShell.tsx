/** Adaptive Material authentication scaffold, shared by every account flow. */
import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../ui/Text";
import { MaterialIcon } from "../ui/MaterialIcon";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
export interface AuthShellProps {
  title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode; style?: ViewStyle;
}
export function AuthShell({ title, subtitle, children, footer, style }: AuthShellProps) {
  const { palette, expressive } = useTheme();
  const insets = useSafeAreaInsets();
  const { compactHeight: compact } = useResponsiveLayout();
  const heading = <View style={[styles.heading, compact ? { gap: spacing[8] } : null]}>
    <Text variant={compact ? "headlineSmall" : "headlineLarge"}>{title}</Text>
    {subtitle ? <Text variant="bodyMedium" color="secondary">{subtitle}</Text> : null}
  </View>;
  const mark = <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[12], marginBottom: compact ? spacing[16] : spacing[32] }}>
    <View style={{ width: 48, height: 48, backgroundColor: palette.primaryContainer, borderRadius: expressive ? radius.lg : radius.full, alignItems: "center", justifyContent: "center" }}>
      <MaterialIcon name="bookmark-outline" size={28} color={palette.onPrimaryContainer} />
    </View>
    <Text variant="titleLarge">ordo</Text>
  </View>;
  return <View style={[styles.root, { backgroundColor: palette.background }]}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <ThemedScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.root}
        contentContainerStyle={[styles.container, { justifyContent: compact ? "flex-start" : "center",
          paddingTop: insets.top + (compact ? spacing[16] : spacing[32]), paddingBottom: insets.bottom + (compact ? spacing[16] : spacing[32]),
          paddingLeft: Math.max(insets.left, spacing[24]), paddingRight: Math.max(insets.right, spacing[24]) }]}>
        <View style={styles.shell}>
          <View style={[styles.form, { maxWidth: layout.maxFormWidth }, style]}>
            {mark}{heading}
            <View style={{ marginTop: compact ? spacing[16] : spacing[32] }}>{children}</View>
            {footer ? <View style={{ marginTop: spacing[24] }}>{footer}</View> : null}
          </View>
        </View>
      </ThemedScrollView>
    </KeyboardAvoidingView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, container: { flexGrow: 1, alignItems: "center" },
  shell: { width: "100%", maxWidth: layout.maxFormWidth },
  form: { flex: 1, width: "100%", minWidth: 0 }, heading: { gap: spacing[16] },
});
