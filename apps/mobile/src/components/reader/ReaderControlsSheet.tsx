/**
 * Compact reader appearance controls: font size, font family, theme
 * (system/light/dark/sepia) and — when the effective theme is dark — the
 * AMOLED pure-black toggle. Presented as a FloatingPanel so it matches the
 * app's existing menu/sheet language on phones and tablets alike.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Segmented } from "../ui/Segmented";
import { Text } from "../ui/Text";
import { Toggle } from "../ui/Toggle";
import { spacing } from "../../theme/tokens";
import type {
  ReaderFontFamily,
  ReaderFontSize,
  ReaderPreferences,
  ReaderTheme,
  UpdateReaderPreferencesInput,
} from "@ordo/shared";

const sizeOptions: readonly { value: ReaderFontSize; label: string }[] = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
  { value: "xlarge", label: "XL" },
];

const familyOptions: readonly { value: ReaderFontFamily; label: string }[] = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
];

const themeOptions: readonly { value: ReaderTheme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "sepia", label: "Sepia" },
];

export interface ReaderControlsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  preferences: ReaderPreferences;
  onUpdate: (patch: UpdateReaderPreferencesInput) => void;
  /** Whether the effective reader palette is dark (enables AMOLED). */
  effectiveDark: boolean;
}

function ControlGroup({
  label,
  accessibilityHint,
  children,
}: {
  label: string;
  accessibilityHint: string;
  children: React.ReactNode;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={styles.group}
    >
      <Text variant="label" color="secondary">{label}</Text>
      <View style={styles.groupControl}>{children}</View>
    </View>
  );
}

export function ReaderControlsSheet({
  visible,
  onDismiss,
  preferences,
  onUpdate,
  effectiveDark,
}: ReaderControlsSheetProps) {
  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} maxWidth={420}>
      <PanelHeader title="Reader" align="start" />

      <ControlGroup label="Text size" accessibilityHint="Changes the article text size.">
        <Segmented
          options={sizeOptions}
          value={preferences.fontSize}
          onChange={(fontSize) => onUpdate({ fontSize })}
        />
      </ControlGroup>

      <ControlGroup label="Font" accessibilityHint="Changes the article typeface.">
        <Segmented
          options={familyOptions}
          value={preferences.fontFamily}
          onChange={(fontFamily) => onUpdate({ fontFamily })}
        />
      </ControlGroup>

      <ControlGroup label="Theme" accessibilityHint="Changes the reader theme.">
        <Segmented
          options={themeOptions}
          value={preferences.theme}
          onChange={(theme) => onUpdate({ theme })}
        />
      </ControlGroup>

      <View style={styles.amoledRow}>
        <View style={styles.amoledCopy}>
          <Text variant="bodyStrong">AMOLED black</Text>
          {effectiveDark ? null : (
            <Text variant="footnote" color="tertiary">Available in dark mode</Text>
          )}
        </View>
        <Toggle
          value={preferences.amoled && effectiveDark}
          onValueChange={(amoled) => onUpdate({ amoled })}
          disabled={!effectiveDark}
        />
      </View>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing[10] },
  groupControl: { marginTop: spacing[4] },
  amoledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 44,
  },
  amoledCopy: { flex: 1, minWidth: 0 },
});
