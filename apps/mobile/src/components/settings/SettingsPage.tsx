import React from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { useColumnPadding, type ColumnAlign } from "../../hooks/use-scene-column-insets";
import { Header } from "../ui/Header";
import { ThemedScrollView, type ThemedScrollViewProps } from "../ui/ThemedScrollView";
import { useScrollBarInsets } from "../ui/ScrollBar";
import { Text } from "../ui/Text";
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
  scrollBarInsets: scrollBarInsetsOverride,
  alignTo = "scene",
  ...props
}: ThemedScrollViewProps & { contentWidth?: number; alignTo?: ColumnAlign }) {
  const chromeInsets = useScrollBarInsets();
  const column = useColumnPadding(contentWidth, alignTo);
  const padLeft = column.left;
  const padRight = column.right;

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
  alignTo = "scene",
}: {
  children: React.ReactNode;
  maxWidth?: number;
  alignTo?: ColumnAlign;
  style?: StyleProp<ViewStyle>;
}) {
  const column = useColumnPadding(maxWidth, alignTo);

  return (
    <View style={styles.contentFrame}>
      <View
        style={[
          styles.contentColumn,
          {
            maxWidth,
            paddingLeft: column.left,
            paddingRight: column.right,
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
