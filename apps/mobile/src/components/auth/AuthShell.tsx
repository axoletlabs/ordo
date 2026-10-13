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
            <View style={[styles.brand, { marginBottom: compact ? spacing[16] : spacing[24] }]}>
              <View style={[
                styles.mark,
                { backgroundColor: palette.primaryContainer, borderRadius: expressive ? radius.lg : radius.full },
              ]}>
                <MaterialIcon name="bookmark-outline" size={24} color={palette.onPrimaryContainer} accessible={false} />
              </View>
              <Text variant="titleMedium" color="secondary">ordo</Text>
            </View>
            <View style={styles.heading}>
              <Text variant={compact ? "headlineSmall" : "headlineLarge"} accessibilityRole="header">{title}</Text>
              {subtitle ? <Text variant="bodyMedium" color="secondary">{subtitle}</Text> : null}
            </View>
            <View style={{ marginTop: compact ? spacing[16] : spacing[24] }}>{children}</View>
            {footer ? <View style={{ marginTop: spacing[16] }}>{footer}</View> : null}
            {secondaryFooter ? (
              <View style={[styles.secondaryFooter, { borderTopColor: palette.outlineVariant }]}>
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
  brand: { flexDirection: "row", alignItems: "center", gap: spacing[12] },
  mark: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  heading: { gap: spacing[8] },
  secondaryFooter: { marginTop: spacing[16], paddingTop: spacing[8], borderTopWidth: StyleSheet.hairlineWidth },
});
