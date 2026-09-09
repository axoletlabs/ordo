import React from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ScrollViewProps,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Header } from "../ui/Header";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { Text } from "../ui/Text";
import { Card } from "../ui/Card";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, spacing } from "../../theme/tokens";

interface SettingsPageProps {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}

export function SettingsPage({ title, children, right }: SettingsPageProps) {
  const { palette } = useTheme();
  const router = useRouter();

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <Header
        title={title}
        showBack
        right={right}
        maxWidth={layout.maxSettingsWidth}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/settings"))}
      />
      {children}
    </View>
  );
}

export function SettingsScrollView({
  children,
  contentContainerStyle,
  contentWidth = layout.maxSettingsWidth,
  ...props
}: ScrollViewProps & { contentWidth?: number }) {
  const insets = useSafeAreaInsets();

  return (
    <ThemedScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingLeft: insets.left + spacing[16],
          paddingRight: insets.right + spacing[16],
        },
        contentContainerStyle,
      ]}
      {...props}
    >
      <View style={[styles.contentColumn, { maxWidth: contentWidth }]}>{children}</View>
    </ThemedScrollView>
  );
}

export function SettingsContent({
  children,
  maxWidth = layout.maxSettingsWidth,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.contentFrame,
        {
          paddingLeft: insets.left + spacing[16],
          paddingRight: insets.right + spacing[16],
        },
      ]}
    >
      <View style={[styles.contentColumn, { maxWidth }, style]}>{children}</View>
    </View>
  );
}

export function SettingsForm({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.formColumn, style]}>{children}</View>;
}

export function SettingsSectionLabel({
  children,
  compact,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <Text
      variant="label"
      color="secondary"
      style={[styles.sectionLabel, compact && styles.compactSectionLabel]}
    >
      {children}
    </Text>
  );
}

export function SettingsGroup({
  label,
  compact,
  footer,
  children,
  style,
}: {
  label?: string;
  compact?: boolean;
  footer?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {label ? <SettingsSectionLabel compact={compact}>{label}</SettingsSectionLabel> : null}
      <Card pad={0} radiusKey="2xl" style={styles.group}>
        {children}
      </Card>
      {footer ? (
        <Text variant="caption" color="tertiary" style={styles.groupFooter}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { flex: 1 },
  // The header→content gap is defined once here; screens must not add their
  // own top padding for the first group (compact labels sit flush under it).
  scrollContent: { paddingTop: spacing[8], paddingBottom: spacing[40] },
  contentFrame: { width: "100%", paddingTop: spacing[8] },
  contentColumn: { width: "100%", alignSelf: "center" },
  formColumn: { width: "100%", alignSelf: "center" },
  sectionLabel: {
    paddingTop: spacing[16],
    paddingBottom: spacing[6],
  },
  compactSectionLabel: { paddingTop: spacing[0] },
  group: { overflow: "hidden" },
  groupFooter: { paddingHorizontal: spacing[4], paddingTop: spacing[6] },
});
