/** Adaptive Material authentication scaffold, shared by every account flow. */
import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../ui/Text";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, spacing } from "../../theme/tokens";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  secondaryFooter?: React.ReactNode;
  style?: ViewStyle;
}
export function AuthShell({ title, subtitle, children, footer, secondaryFooter, style }: AuthShellProps) {
  const { palette, expressive } = useTheme();
  const insets = useSafeAreaInsets();
  const { compactHeight: compact } = useResponsiveLayout();
  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <ThemedScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={styles.root}
          contentContainerStyle={[
            styles.container,
            {
              justifyContent: compact ? "flex-start" : "center",
              paddingTop: insets.top + (compact ? spacing[16] : spacing[32]),
              paddingBottom: insets.bottom + (compact ? spacing[16] : spacing[32]),
              paddingLeft: Math.max(insets.left, layout.screenHorizontalPad),
              paddingRight: Math.max(insets.right, layout.screenHorizontalPad),
            },
          ]}
        >
          <View style={[styles.form, style]}>
            <View testID="auth-brand" style={{ marginBottom: compact ? spacing[16] : spacing[24] }}>
              <Text variant="titleMedium" color="secondary">ordo</Text>
            </View>
            <View testID="auth-header" style={styles.heading}>
              <Text variant={compact ? "headlineSmall" : expressive ? "displaySmall" : "headlineLarge"} accessibilityRole="header">{title}</Text>
              {subtitle ? <Text variant="bodyMedium" color="secondary">{subtitle}</Text> : null}
            </View>
            <View style={{ marginTop: compact ? spacing[16] : spacing[24] }}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
            {secondaryFooter ? (
              <View style={styles.secondaryFooter}>
                {secondaryFooter}
              </View>
            ) : null}
          </View>
        </ThemedScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, alignItems: "center" },
  form: { width: "100%", maxWidth: layout.maxFormWidth, minWidth: 0 },
  heading: { gap: spacing[8] },
  footer: { marginTop: spacing[16], alignItems: "center" },
  secondaryFooter: { marginTop: spacing[8], alignItems: "center" },
});
