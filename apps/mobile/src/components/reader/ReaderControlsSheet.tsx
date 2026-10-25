/**
 * Reader appearance controls: text size, typeface,
 * line spacing, theme (system/light/dark) and the AMOLED pure-black toggle
 * (disabled in light mode). Presented as a FloatingPanel so it
 * matches the app's existing menu/sheet language on phones and tablets alike.
 *
 * The panel owns its open state and its own preference subscription. Opening
 * it therefore opens the controls without re-rendering the reader surface,
 * and a preference press reaches the panel immediately while the article waits
 * for the deferred content preference.
 */
import React, { useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { AnimatedDisclosure } from "../ui/AnimatedDisclosure";
import { PanelHeader } from "../ui/PanelHeader";
import { Segmented } from "../ui/Segmented";
import { Text } from "../ui/Text";
import { Toggle } from "../ui/Toggle";
import { LazyMount } from "../ui/LazyMount";
import { PanelPresenceContext } from "../ui/panel-presence";
import { spacing } from "../../theme/tokens";
import { loadReaderFontPreview, loadReaderFontPreviews, preloadReaderFontPreviews, READER_FONT_FAMILY_LIST, readerFontPreviewReady, resolveReaderFontPreview, useReaderFontRevision } from "../../theme/fonts";
import { useReaderPreferences } from "../../hooks/use-reader-preferences";
import { useAnimationActivityEffect, useAppForeground } from "../../hooks/use-animation-activity";
import { usePreparedReaderOverlay } from "./use-prepared-reader-overlay";
import type { ReaderWorkScheduler } from "./reader-work";
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
}[] = [
  { value: "serif", label: "Libron", accessibilityLabel: "Libron, a reading serif" },
  { value: "sans", label: "Legible Sans", accessibilityLabel: "Legible Sans, an accessible sans serif" },
  { value: "garamond", label: "Garamond", accessibilityLabel: "Garamond, a classical old-style serif" },
  { value: "bitter", label: "Bitter", accessibilityLabel: "Bitter, a contemporary slab serif" },
  { value: "jost", label: "Jost", accessibilityLabel: "Jost, a geometric sans serif" },
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

/** Spread optional, tiny preview registrations across dormant idle slices. */
const PREVIEW_STAGGER_MS = 160;
/** Must match the keyed group array in ReaderControlsBody. */
const CONTROL_GROUP_COUNT = 5;
const PreviewFreezeContext = React.createContext(false);
const previewLabelStyles = new Map<string, { fontFamily: string }>();
function previewLabelStyle(fontFamily: string | undefined) {
  if (!fontFamily) return undefined;
  let style = previewLabelStyles.get(fontFamily);
  if (!style) { style = Object.freeze({ fontFamily }); previewLabelStyles.set(fontFamily, style); }
  return style;
}

export interface ReaderControlsSheetHandle {
  open(): void;
  prepare(): void;
}

export interface ReaderControlsSheetProps {
  /** The reader dismisses its selection/overflow surfaces when this opens. */
  onOpen?: () => void;
  /** Whether the effective reader palette is dark (enables AMOLED). */
  effectiveDark: boolean;
  workScheduler: ReaderWorkScheduler;
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
  const entering = useContext(PreviewFreezeContext);
  const presence = useContext(PanelPresenceContext);
  // FloatingPanel freezes its last children for exit. Its live presence scope
  // still changes, so a stale child snapshot cannot adopt fonts mid-exit.
  const frozen = presence ? presence.rendered && (!presence.visible || entering) : entering;
  const fontRevision = useReaderFontRevision();
  const [snapshot, setSnapshot] = useState(() => familyOptions.map((option) => resolveReaderFontPreview(option.value)));
  useEffect(() => {
    // An in-flight arrival must not swap fonts during an entrance or while a
    // finger/key owns a segment. Adopt new previews only on the hidden tree.
    if (frozen) return;
    const next = familyOptions.map((option) => resolveReaderFontPreview(option.value));
    setSnapshot((current) => current.every((family, index) => family === next[index]) ? current : next);
  }, [fontRevision, frozen]);
  const typefaceOptions = useMemo(() => familyOptions.map((option, index) => ({ ...option,
    labelStyle: previewLabelStyle(snapshot[index]),
  })), [snapshot]);
  // Revision notifications may still reach this small subscriber while open.
  // Preserve the element identity so they do not reconcile the animated group.
  return useMemo(() => (
    <Segmented
      accessibilityLabel="Typeface"
      // Vertical rows give each reading typeface room to preview itself.
      orientation="vertical"
      options={typefaceOptions}
      value={value}
      onChange={onChange}
    />
  ), [onChange, typefaceOptions, value]);
});

export const ReaderControlsSheet = React.memo(React.forwardRef<ReaderControlsSheetHandle, ReaderControlsSheetProps>(
  function ReaderControlsSheet({ onOpen, effectiveDark, workScheduler }, ref) {
    const [visible, setVisible] = useState(false);
    const [retaining, setRetaining] = useState(false);
    const [entered, setEntered] = useState(false);
    const visibleRef = useRef(visible);
    useLayoutEffect(() => { visibleRef.current = visible; }, [visible]);
    const { prepared, prepare, retain } = usePreparedReaderOverlay(workScheduler);
    const open = useCallback(() => {
      retain();
      if (!visibleRef.current) {
        setRetaining(true);
        setEntered(false);
      }
      setVisible(true);
      onOpen?.();
    }, [onOpen, retain]);
    const close = useCallback(() => setVisible(false), []);
    const onEntered = useCallback(() => setEntered(true), []);
    const onExited = useCallback(() => { setRetaining(false); setEntered(false); }, []);
    useImperativeHandle(ref, () => ({ open, prepare }), [open, prepare]);
    return (
      <LazyMount active={visible || prepared}>
        {() => <ReaderControlsContent visible={visible} prepared={prepared} onDismiss={close}
          retaining={retaining} entered={entered} onEntered={onEntered} onExited={onExited}
          effectiveDark={effectiveDark} workScheduler={workScheduler} />}
      </LazyMount>
    );
  },
));

const ReaderControlsContent = React.memo(function ReaderControlsContent({
  visible,
  onDismiss,
  effectiveDark,
  prepared,
  workScheduler,
  retaining,
  entered,
  onEntered,
  onExited,
}: {
  visible: boolean;
  onDismiss: () => void;
  effectiveDark: boolean;
  prepared: boolean;
  workScheduler: ReaderWorkScheduler;
  retaining: boolean;
  entered: boolean;
  onEntered: () => void;
  onExited: () => void;
}) {
  const previewIdle = !retaining || (visible && entered);
  const foreground = useAppForeground();
  // Staging lives in the publisher's background activity scope, not in the
  // dormant portal layer (whose scope is intentionally paused). One group per
  // idle slice; urgent visible renders all groups via the body's display slice.
  const [preparedCount, setPreparedCount] = useState(1);
  useAnimationActivityEffect(useCallback((active: boolean) => {
    if (!active || visible || preparedCount >= CONTROL_GROUP_COUNT) return;
    return workScheduler.schedule(() => {
      setPreparedCount((current) => Math.min(CONTROL_GROUP_COUNT, current + 1));
    });
  }, [preparedCount, visible, workScheduler]));
  useLayoutEffect(() => {
    if (visible && preparedCount < CONTROL_GROUP_COUNT) setPreparedCount(CONTROL_GROUP_COUNT);
  }, [preparedCount, visible]);
  // Prepare previews only after the body's group commits are complete (or a
  // visible panel has passed its entrance). This keeps font-set mutations out
  // of the same dormant slice series as control-group layout.
  const groupsReady = preparedCount >= CONTROL_GROUP_COUNT || (visible && entered);
  // No fixed wait, background pause deferral or first-frame shell is involved.
  useAnimationActivityEffect(useCallback((active: boolean) => {
    // Dormant work cancels synchronously when another surface opens. A settled
    // visible settings panel is itself the reason its publisher is blocked.
    if (!prepared || !previewIdle || !foreground || !groupsReady || (!active && !visible)) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const idleCancels: (() => void)[] = [];
    const families = READER_FONT_FAMILY_LIST
      .filter((family) => !readerFontPreviewReady(family));
    if (Platform.OS === "web") {
      // Dormant: fetch/decode only, never mutate document.fonts or publish a
      // revision while the article is the only visible surface. Registration
      // waits for the real visible entrance and reuses the cached faces.
      if (families.length) {
        idleCancels.push(workScheduler.schedule(() => {
          if (cancelled) return;
          if (visible && entered) void loadReaderFontPreviews(families);
          else void preloadReaderFontPreviews(families);
        }));
      }
    } else {
      families.forEach((family, index) => {
        timers.push(setTimeout(() => {
          if (cancelled) return;
          idleCancels.push(workScheduler.schedule(() => {
            if (!cancelled) void loadReaderFontPreview(family);
          }));
        }, index * PREVIEW_STAGGER_MS));
      });
    }
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      idleCancels.forEach((cancel) => cancel());
    };
  }, [entered, foreground, groupsReady, prepared, previewIdle, visible, workScheduler]));
  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} keepMounted={prepared} onEntered={onEntered} onExited={onExited}>
      <PanelHeader title="Reader" onClose={onDismiss} />
      <PreviewFreezeContext.Provider value={!previewIdle}>
        <ReaderControlsBody effectiveDark={effectiveDark} visible={visible} preparedCount={preparedCount} />
      </PreviewFreezeContext.Provider>
    </FloatingPanel>
  );
});

const ReaderControlsBody = React.memo(function ReaderControlsBody({
  effectiveDark,
  visible,
  preparedCount,
}: {
  effectiveDark: boolean;
  visible: boolean;
  preparedCount: number;
}) {
  const { width, fontScale } = useWindowDimensions();
  const orientation = width < 360 || fontScale > 1.3 ? "vertical" : "horizontal";
  const { preferences, setPreferences } = useReaderPreferences();
  // Stable for TypefaceSegmented's memo: an unrelated preference change must
  // not re-render the five typeface options.
  const updateFontFamily = useCallback(
    (fontFamily: ReaderFontFamily) => setPreferences({ fontFamily }),
    [setPreferences],
  );
  // Keyed, stable group elements: increasing preparedCount appends one element
  // without changing any already-mounted group's identity. A preference,
  // orientation or effective-dark change intentionally replaces the relevant
  // elements; preparedCount is deliberately not a dependency.
  const groups = useMemo(() => [
    <ControlGroup key="size" label="Text size" accessibilityHint="Changes the article text size.">
      <Segmented
        accessibilityLabel="Text size"
        orientation={orientation}
        options={sizeOptions}
        value={preferences.fontSize}
        onChange={(fontSize) => setPreferences({ fontSize })}
      />
    </ControlGroup>,
    <ControlGroup key="typeface" label="Typeface" accessibilityHint="Changes the article typeface.">
      <TypefaceSegmented value={preferences.fontFamily} onChange={updateFontFamily} />
    </ControlGroup>,
    <ControlGroup key="spacing" label="Line spacing" accessibilityHint="Changes the article line spacing.">
      <Segmented
        accessibilityLabel="Line spacing"
        orientation={orientation}
        options={lineSpacingOptions}
        value={preferences.lineSpacing ?? "default"}
        onChange={(lineSpacing) => setPreferences({ lineSpacing })}
      />
    </ControlGroup>,
    <ControlGroup key="theme" label="Theme" accessibilityHint="Changes the reader theme.">
      <Segmented
        accessibilityLabel="Reader theme"
        orientation={orientation}
        options={themeOptions}
        value={preferences.theme}
        onChange={(theme) => setPreferences({ theme })}
      />
    </ControlGroup>,
    <View key="amoled" style={styles.amoledRow}>
      <View style={styles.amoledCopy}>
        <Text variant="bodyStrong">AMOLED black</Text>
        <AnimatedDisclosure expanded={!effectiveDark}>
          <Text variant="footnote" color="tertiary">Switch the reader to dark mode to use pure black.</Text>
        </AnimatedDisclosure>
      </View>
      <Toggle
        accessibilityLabel="Reader AMOLED black"
        accessibilityHint={!effectiveDark ? "Switch the reader to dark mode to use pure black." : undefined}
        disabled={!effectiveDark}
        value={preferences.amoled}
        onValueChange={(amoled) => setPreferences({ amoled })}
      />
    </View>,
  ], [
    effectiveDark,
    orientation,
    preferences.amoled,
    preferences.fontFamily,
    preferences.fontSize,
    preferences.lineSpacing,
    preferences.theme,
    setPreferences,
    updateFontFamily,
  ]);
  const totalGroups = groups.length;
  // The content owns staging so it runs in the publisher's background scope.
  // Never show an empty shell to an early visible open: the display slice is
  // full while visible, independent of how much dormant staging completed.
  const displayedCount = visible ? totalGroups : Math.min(preparedCount, totalGroups);
  // Only the article uses reading size/spacing; controls keep UI metrics.
  // Typeface labels preview each font without resizing the panel.
  return <View>{groups.slice(0, displayedCount)}</View>;
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
