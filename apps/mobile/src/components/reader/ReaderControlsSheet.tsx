/**
 * Reader appearance controls: text size, typeface,
 * line spacing, theme (system/light/dark) and — when the effective theme is
 * dark — the AMOLED pure-black toggle. Presented as a FloatingPanel so it
 * matches the app's existing menu/sheet language on phones and tablets alike.
 *
 * The panel owns its open state and its own preference subscription. Opening
 * it therefore mounts the controls without re-rendering the reader surface,
 * and a preference press reaches the panel immediately while the article waits
 * for the deferred content preference.
 */
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Segmented } from "../ui/Segmented";
import { Text } from "../ui/Text";
import { Toggle } from "../ui/Toggle";
import { LazyMount } from "../ui/LazyMount";
import { spacing } from "../../theme/tokens";
import { resolveReaderFont } from "./reader-typography";
import { loadReaderFontPreview, READER_FONT_FAMILY_LIST, readerFontPreviewReady, useReaderFontRevision } from "../../theme/fonts";
import { scheduleIdleWork } from "../../lib/idle-work";
import { useReaderPreferences } from "../../hooks/use-reader-preferences";
import type {
  ReaderFontFamily,
  ReaderFontSize,
  ReaderLineSpacing,
  ReaderTheme,
} from "@ordo/shared";

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
  labelStyle?: { fontFamily: string };
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

/** Let the panel's entrance finish before optional preview faces load. */
const PREVIEW_DELAY_MS = 240;
/** Stagger starts so font polling overlaps instead of serializing. */
const PREVIEW_STAGGER_MS = 160;

export interface ReaderControlsSheetHandle {
  open(): void;
}

export interface ReaderControlsSheetProps {
  /** The reader dismisses its selection/overflow surfaces when this opens. */
  onOpen?: () => void;
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

/**
 * Only this control cares when preview faces arrive. Keeping the revision
 * subscription here (rather than in the panel) means a background preview
 * load re-renders the typeface options, not the header or the four other
 * control groups that did not change.
 */
const TypefaceSegmented = React.memo(function TypefaceSegmented({
  value,
  onChange,
}: {
  value: ReaderFontFamily;
  onChange: (family: ReaderFontFamily) => void;
}) {
  const fontRevision = useReaderFontRevision();
  const typefaceOptions = useMemo(
    () => familyOptions.map((option) => readerFontPreviewReady(option.value) ? option : { ...option, labelStyle: undefined }),
    // Readiness lives outside React; the revision says when it changed.
    [fontRevision],
  );
  return (
    <Segmented
      accessibilityLabel="Typeface"
      // Vertical rows give each reading typeface room to preview itself.
      orientation="vertical"
      options={typefaceOptions}
      value={value}
      onChange={onChange}
    />
  );
});

export const ReaderControlsSheet = React.memo(React.forwardRef<ReaderControlsSheetHandle, ReaderControlsSheetProps>(
  function ReaderControlsSheet({ onOpen, effectiveDark }, ref) {
    const [visible, setVisible] = useState(false);
    const open = useCallback(() => {
      setVisible(true);
      onOpen?.();
    }, [onOpen]);
    const close = useCallback(() => setVisible(false), []);
    useImperativeHandle(ref, () => ({ open }), [open]);
    return (
      <LazyMount active={visible}>
        {() => <ReaderControlsContent visible={visible} onDismiss={close} effectiveDark={effectiveDark} />}
      </LazyMount>
    );
  },
));

const ReaderControlsContent = React.memo(function ReaderControlsContent({
  visible,
  onDismiss,
  effectiveDark,
}: {
  visible: boolean;
  onDismiss: () => void;
  effectiveDark: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const orientation = width < 360 || fontScale > 1.3 ? "vertical" : "horizontal";
  const { preferences, setPreferences } = useReaderPreferences();
  // Previews need every reading family's regular face. Loading those is still
  // a batch of font registrations, so never do it on the open path: let the
  // panel paint and finish its entrance, then start one family per idle slice.
  // Starts are staggered rather than chained so several faces observe in
  // parallel; waiting for one before starting the next kept font polling busy
  // for seconds on slow devices. A close cancels anything not started.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const idleCancels: (() => void)[] = [];
    READER_FONT_FAMILY_LIST
      .filter((family) => !readerFontPreviewReady(family))
      .forEach((family, index) => {
        timers.push(setTimeout(() => {
          if (cancelled) return;
          idleCancels.push(scheduleIdleWork(() => {
            if (!cancelled) void loadReaderFontPreview(family);
          }));
        }, PREVIEW_DELAY_MS + index * PREVIEW_STAGGER_MS));
      });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      idleCancels.forEach((cancel) => cancel());
    };
  }, [visible]);
  // Stable for TypefaceSegmented's memo: an unrelated preference change must
  // not re-render the five typeface options.
  const updateFontFamily = useCallback(
    (fontFamily: ReaderFontFamily) => setPreferences({ fontFamily }),
    [setPreferences],
  );
  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss}>
      <PanelHeader title="Reader" onClose={onDismiss} />

      {/* Only the article uses reading size/spacing; controls keep UI metrics.
          Typeface labels preview each font without resizing the panel. */}
      <View>
      <ControlGroup label="Text size" accessibilityHint="Changes the article text size.">
        <Segmented
          accessibilityLabel="Text size"
          orientation={orientation}
          options={sizeOptions}
          value={preferences.fontSize}
          onChange={(fontSize) => setPreferences({ fontSize })}
        />
      </ControlGroup>

      <ControlGroup label="Typeface" accessibilityHint="Changes the article typeface.">
        <TypefaceSegmented value={preferences.fontFamily} onChange={updateFontFamily} />
      </ControlGroup>

      <ControlGroup label="Line spacing" accessibilityHint="Changes the article line spacing.">
        <Segmented
          accessibilityLabel="Line spacing"
          orientation={orientation}
          options={lineSpacingOptions}
          value={preferences.lineSpacing ?? "default"}
          onChange={(lineSpacing) => setPreferences({ lineSpacing })}
        />
      </ControlGroup>

      <ControlGroup label="Theme" accessibilityHint="Changes the reader theme.">
        <Segmented
          accessibilityLabel="Reader theme"
          orientation={orientation}
          options={themeOptions}
          value={preferences.theme}
          onChange={(theme) => setPreferences({ theme })}
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
          onValueChange={(amoled) => setPreferences({ amoled })}
          disabled={!effectiveDark}
        />
      </View>
      </View>
    </FloatingPanel>
  );
});

const styles = StyleSheet.create({
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
