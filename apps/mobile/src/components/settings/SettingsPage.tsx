import React from "react";
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Header } from "../ui/Header";
import { ThemedScrollView, type ThemedScrollViewProps } from "../ui/ThemedScrollView";
import { useScrollBarInsets } from "../ui/ScrollBar";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { columnContentInset } from "../../theme/alignment";
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
  scrollBarInsets: scrollBarInsetsOverride,
  ...props
}: ThemedScrollViewProps & { contentWidth?: number }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const chromeInsets = useScrollBarInsets();
  const padLeft = columnContentInset(insets.left, width, contentWidth);
  const padRight = columnContentInset(insets.right, width, contentWidth);

  return (
    <ThemedScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      scrollBarInsets={scrollBarInsetsOverride ?? chromeInsets}
      {...props}
    >
      <View
        style={[
          styles.contentColumn,
          { maxWidth: contentWidth, paddingLeft: padLeft, paddingRight: padRight },
        ]}
      >
        {children}
      </View>
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
  const { width } = useWindowDimensions();

  return (
    <View style={styles.contentFrame}>
      <View
        style={[
          styles.contentColumn,
          {
            maxWidth,
            paddingLeft: columnContentInset(insets.left, width, maxWidth),
            paddingRight: columnContentInset(insets.right, width, maxWidth),
          },
          style,
        ]}
      >
        {children}
      </View>
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
      <View style={styles.group}>{children}</View>
      {footer ? (
        <Text variant="footnote" color="tertiary" style={styles.groupFooter}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { flex: 1 },
  // Header owns the gap above the first group. Compact labels sit flush;
  // later section labels add their own top padding.
  scrollContent: { paddingBottom: spacing[40] },
  contentFrame: { width: "100%" },
  contentColumn: { width: "100%", alignSelf: "center" },
  // Matches the list-row well: fields start one row inset in from the rail.
  formColumn: {
    width: "100%",
    alignSelf: "center",
    padding: layout.rowInset,
    gap: spacing[12],
  },
  sectionLabel: {
    paddingTop: spacing[16],
    paddingBottom: spacing[6],
  },
  compactSectionLabel: { paddingTop: spacing[0] },
  group: { width: "100%" },
  groupFooter: { paddingTop: spacing[6] },
});
