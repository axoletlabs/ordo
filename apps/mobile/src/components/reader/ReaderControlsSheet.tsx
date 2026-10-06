/**
 * Reader appearance controls: a live type specimen, text size, typeface,
 * line spacing, theme (system/light/dark) and — when the effective theme is
 * dark — the AMOLED pure-black toggle. Presented as a FloatingPanel so it
 * matches the app's existing menu/sheet language on phones and tablets alike.
 */
import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Segmented } from "../ui/Segmented";
import { Text } from "../ui/Text";
import { Toggle } from "../ui/Toggle";
import { radius, spacing } from "../../theme/tokens";
import {
  READER_BODY_SIZE,
  readerLineHeight,
  resolveReaderFont,
} from "./reader-typography";
import type {
  ReaderFontFamily,
  ReaderFontSize,
  ReaderLineSpacing,
  ReaderPreferences,
  ReaderTheme,
  UpdateReaderPreferencesInput,
} from "@ordo/shared";
import { useTheme } from "../../theme/ThemeProvider";

const sizeOptions: readonly { value: ReaderFontSize; label: string; accessibilityLabel: string }[] = [
  { value: "small", label: "S", accessibilityLabel: "Small" },
  { value: "medium", label: "M", accessibilityLabel: "Medium" },
  { value: "large", label: "L", accessibilityLabel: "Large" },
  { value: "xlarge", label: "XL", accessibilityLabel: "Extra large" },
];

// Each option renders in its own typeface so the choice previews itself.
const familyOptions: readonly {
  value: ReaderFontFamily;
  label: string;
  accessibilityLabel: string;
  labelStyle: { fontFamily: string };
}[] = [
  { value: "serif", label: "Libron", accessibilityLabel: "Libron, a reading serif", labelStyle: { fontFamily: resolveReaderFont("serif") } },
  { value: "sans", label: "Legible Sans", accessibilityLabel: "Legible Sans, an accessible sans serif", labelStyle: { fontFamily: resolveReaderFont("sans") } },
  { value: "garamond", label: "Garamond", accessibilityLabel: "Garamond, a classical old-style serif", labelStyle: { fontFamily: resolveReaderFont("garamond") } },
  { value: "bitter", label: "Bitter", accessibilityLabel: "Bitter, a contemporary slab serif", labelStyle: { fontFamily: resolveReaderFont("bitter") } },
  { value: "jost", label: "Jost", accessibilityLabel: "Jost, a geometric sans serif", labelStyle: { fontFamily: resolveReaderFont("jost") } },
];

const lineSpacingOptions: readonly { value: ReaderLineSpacing; label: string; accessibilityLabel: string }[] = [
  { value: "compact", label: "Tight", accessibilityLabel: "Tight line spacing" },
  { value: "default", label: "Default", accessibilityLabel: "Default line spacing" },
  { value: "relaxed", label: "Wide", accessibilityLabel: "Wide line spacing" },
];

const themeOptions: readonly { value: ReaderTheme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
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
      accessibilityRole="none"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={styles.group}
    >
      <Text variant="label" color="secondary">{label}</Text>
      <View style={styles.groupControl}>{children}</View>
    </View>
  );
}

export const ReaderControlsSheet = React.memo(function ReaderControlsSheet({
  visible,
  onDismiss,
  preferences,
  onUpdate,
  effectiveDark,
}: ReaderControlsSheetProps) {
  const { palette } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const orientation = width < 360 || fontScale > 1.3 ? "vertical" : "horizontal";
  const bodySize = READER_BODY_SIZE[preferences.fontSize];
  const specimen = {
    fontFamily: resolveReaderFont(preferences.fontFamily),
    fontSize: bodySize,
    lineHeight: readerLineHeight(bodySize, preferences.lineSpacing ?? "default"),
    color: palette.onSurface,
  };
  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss}>
      <PanelHeader title="Reader" onClose={onDismiss} />

      <View style={styles.body}>
      <View
        accessibilityRole="text"
        accessibilityLabel="Type specimen"
        style={[styles.specimen, { backgroundColor: palette.surfaceContainerLow }]}
      >
        <Text variant="label" color="tertiary" style={styles.specimenKicker}>
          Preview
        </Text>
        <Text style={[specimen, styles.specimenBody]} numberOfLines={3}>
          The quiet habit of reading well is mostly the habit of returning —
          to the page, to the passage, to the sentence that started it.
        </Text>
      </View>

      <ControlGroup label="Text size" accessibilityHint="Changes the article text size.">
        <Segmented
          accessibilityLabel="Text size"
          orientation={orientation}
          options={sizeOptions}
          value={preferences.fontSize}
          onChange={(fontSize) => onUpdate({ fontSize })}
        />
      </ControlGroup>

      <ControlGroup label="Typeface" accessibilityHint="Changes the article typeface.">
        <Segmented
          accessibilityLabel="Typeface"
          // Vertical rows give each reading typeface room to preview itself.
          orientation="vertical"
          options={familyOptions}
          value={preferences.fontFamily}
          onChange={(fontFamily) => onUpdate({ fontFamily })}
        />
      </ControlGroup>

      <ControlGroup label="Line spacing" accessibilityHint="Changes the article line spacing.">
        <Segmented
          accessibilityLabel="Line spacing"
          orientation={orientation}
          options={lineSpacingOptions}
          value={preferences.lineSpacing ?? "default"}
          onChange={(lineSpacing) => onUpdate({ lineSpacing })}
        />
      </ControlGroup>

      <ControlGroup label="Theme" accessibilityHint="Changes the reader theme.">
        <Segmented
          accessibilityLabel="Reader theme"
          orientation={orientation}
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
          accessibilityLabel="Reader AMOLED black"
          value={preferences.amoled && effectiveDark}
          onValueChange={(amoled) => onUpdate({ amoled })}
          disabled={!effectiveDark}
        />
      </View>
      </View>
    </FloatingPanel>
  );
});

const styles = StyleSheet.create({
  body: {},
  specimen: {
    borderRadius: radius.md,
    padding: spacing[16],
    marginBottom: spacing[24],
  },
  specimenKicker: { marginBottom: spacing[6] },
  specimenBody: {},
  group: { marginBottom: spacing[24] },
  groupControl: { marginTop: spacing[8] },
  amoledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 48,
  },
  amoledCopy: { flex: 1, minWidth: 0 },
});
