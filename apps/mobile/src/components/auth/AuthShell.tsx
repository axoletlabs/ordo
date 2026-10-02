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
  const { width, isLandscape, isTablet } = useResponsiveLayout();
  const wide = width >= 960;
  const compact = isLandscape && !isTablet;
  const heading = <View style={styles.heading}>
    <Text variant="headlineLarge">{title}</Text>
    {subtitle ? <Text variant="bodyMedium" color="secondary">{subtitle}</Text> : null}
  </View>;
  const mark = <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[12], marginBottom: spacing[32] }}>
    <View style={{ width: 48, height: 48, backgroundColor: palette.primaryContainer, borderRadius: expressive ? radius.lg : radius.full, alignItems: "center", justifyContent: "center" }}>
      <MaterialIcon name="bookmark-outline" size={28} color={palette.onPrimaryContainer} />
    </View>
    <Text variant="titleLarge">ordo</Text>
  </View>;
  return <View style={[styles.root, { backgroundColor: palette.background }]}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <ThemedScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.root}
        contentContainerStyle={[styles.container, { justifyContent: compact ? "flex-start" : "center",
          paddingTop: insets.top + spacing[32], paddingBottom: insets.bottom + spacing[32],
          paddingLeft: Math.max(insets.left, spacing[24]), paddingRight: Math.max(insets.right, spacing[24]) }]}>
        <View style={[styles.shell, wide ? styles.wide : null]}>
          {wide ? <View style={[styles.brand, { backgroundColor: palette.primaryContainer, borderRadius: expressive ? radius["4xl"] : radius["2xl"] }]}>
            <View style={{ width: 96, height: 96, alignItems: "center", justifyContent: "center", backgroundColor: palette.tertiaryContainer, borderRadius: expressive ? radius["2xl"] : radius.full }}>
              <MaterialIcon name="bookmark-outline" size={56} color={palette.onTertiaryContainer} />
            </View>
            <Text variant={expressive ? "displayMedium" : "displaySmall"} style={{ color: palette.onPrimaryContainer }}>A place for everything you want to read.</Text>
            <Text variant="bodyLarge" style={{ color: palette.onPrimaryContainer }}>Save links. Make collections. Pick up where you left off.</Text>
          </View> : null}
          <View style={[styles.form, { maxWidth: layout.maxFormWidth }, style]}>
            {mark}{heading}
            <View style={{ marginTop: spacing[32] }}>{children}</View>
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
  wide: { maxWidth: 1120, flexDirection: "row", alignItems: "center", gap: spacing[64] },
  brand: { flex: 1, minWidth: 0, padding: spacing[40], minHeight: 480, justifyContent: "center", gap: spacing[32] },
  form: { flex: 1, width: "100%", minWidth: 0 }, heading: { gap: spacing[16] },
});
