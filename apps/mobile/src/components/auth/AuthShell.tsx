/**
 * Shared branded scaffold for auth screens (login/register/verify).
 * Scrollable, safe-area aware, with the content centered (matching the old
 * app's Center + SingleChildScrollView + Column layout) and a footer slot.
 */
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../ui/Text";
import { AUTH_LOGO_WIDTH, Logo } from "../ui/Logo";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, spacing } from "../../theme/tokens";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  style?: ViewStyle;
}

export function AuthShell({ title, subtitle, children, footer, style }: AuthShellProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, isLandscape, isTablet } = useResponsiveLayout();
  const isWideLayout = width >= 960;
  const compactLandscape = isLandscape && !isTablet && !isWideLayout;
  const topPadding = insets.top + (compactLandscape ? spacing[16] : spacing[24]);
  const bottomPadding = insets.bottom + (compactLandscape ? spacing[16] : spacing[24]);
  const contentTopMargin = compactLandscape ? spacing[16] : spacing[24];
  const footerTopMargin = compactLandscape ? spacing[16] : spacing[20];
  const titleTopMargin = compactLandscape ? spacing[12] : spacing[16];
  const subtitleTopMargin = compactLandscape ? spacing[4] : spacing[6];
  const horizontalPadding = isWideLayout ? spacing[32] : spacing[24];

  const brandHeader = (
    <>
      <Logo width={AUTH_LOGO_WIDTH} />
      <Text variant="header" align="center" style={{ marginTop: titleTopMargin }}>
        {title}
      </Text>
      {subtitle ? (
        <Text
          variant="footnote"
          color="secondary"
          align="center"
          style={{ marginTop: subtitleTopMargin }}
        >
          {subtitle}
        </Text>
      ) : null}
    </>
  );

  const formBody = (
    <>
      <View style={{ marginTop: contentTopMargin }}>{children}</View>
      {footer ? <View style={[styles.footer, { marginTop: footerTopMargin }]}>{footer}</View> : null}
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.root}
      >
        <ThemedScrollView
          style={styles.root}
          contentContainerStyle={[
            styles.container,
            isWideLayout ? styles.wideContainer : compactLandscape ? styles.compactContainer : styles.centeredContainer,
            {
              paddingTop: topPadding,
              paddingBottom: bottomPadding,
              paddingLeft: insets.left + horizontalPadding,
              paddingRight: insets.right + horizontalPadding,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {isWideLayout ? (
            <View style={styles.wideShell}>
              <View style={styles.brandPane}>{brandHeader}</View>
              <View style={styles.formPane}>
                <View style={[styles.formInner, style]}>{formBody}</View>
              </View>
            </View>
          ) : (
            <View style={[styles.inner, { maxWidth: layout.maxFormWidth }, style]}>
              {brandHeader}
              {formBody}
            </View>
          )}
        </ThemedScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flexGrow: 1,
    alignItems: "center",
  },
  centeredContainer: { justifyContent: "center" },
  compactContainer: { justifyContent: "flex-start" },
  wideContainer: { justifyContent: "center" },
  inner: { width: "100%", alignSelf: "center" },
  wideShell: {
    width: "100%",
    maxWidth: layout.maxLibraryWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[32],
  },
  brandPane: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  formPane: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  formInner: { width: "100%", maxWidth: layout.maxFormWidth },
  footer: {},
});
