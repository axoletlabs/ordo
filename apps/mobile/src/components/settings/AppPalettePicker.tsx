import React, { useMemo, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useRadioGroupKeys } from "../../hooks/use-radio-group-keys";
import { haptics } from "../../lib/haptics";
import { useSettingsStore } from "../../store/settings";
import { APP_PALETTES, appPaletteName, normalizeAppColor } from "../../theme/app-colors";
import { materialColorRoles, type MaterialColors } from "../../theme/material-colors";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Input } from "../ui/Input";
import { MaterialIcon } from "../ui/MaterialIcon";
import { PanelHeader } from "../ui/PanelHeader";
import { PressableScale } from "../ui/PressableScale";
import { PanelActions } from "../ui/SheetActionRow";
import { Text } from "../ui/Text";

const seeds = APP_PALETTES.map((option) => option.seed);

/** A miniature of the generated palette, rather than the unadjusted seed. */
function PaletteSwatch({ colors, selected = false }: { colors: MaterialColors; selected?: boolean }) {
  return <View accessible={false} style={[styles.swatch, { backgroundColor: colors.primary }]}>
    <View style={styles.swatchSide}>
      <View style={[styles.tone, { backgroundColor: colors.secondaryContainer }]} />
      <View style={[styles.tone, { backgroundColor: colors.tertiary }]} />
    </View>
    {selected ? <View style={[styles.check, { backgroundColor: colors.primary }]}>
      <MaterialIcon name="checkmark" size={20} color={colors.onPrimary} />
    </View> : null}
  </View>;
}

export function AppPalettePicker({ value, onChange, overridden }: {
  value: string;
  onChange: (color: string) => void;
  overridden: boolean;
}) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const columns = width >= 768 ? 8 : 4;
  const contrast = useSettingsStore((state) => state.themeContrast);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState(false);
  const dark = palette.mode === "dark";
  const options = useMemo(() => APP_PALETTES.map((option) => ({
    ...option, colors: materialColorRoles(option.seed, dark, false, contrast),
  })), [dark, contrast]);
  const choose = (seed: string) => {
    if (overridden || seed === value) return;
    haptics.selection();
    onChange(seed);
  };
  const keys = useRadioGroupKeys(seeds, choose, columns);
  const custom = appPaletteName(value) === "Custom";
  const normalized = normalizeAppColor(draft);
  const preview = useMemo(() => materialColorRoles(normalized ?? value, dark, false, contrast),
    [normalized, value, dark, contrast]);

  const openCustom = () => {
    if (overridden) return;
    setDraft(value);
    setError(false);
    setCustomOpen(true);
    haptics.selection();
  };
  const applyCustom = () => {
    if (!normalized) { setError(true); return; }
    if (overridden) return;
    choose(normalized);
    setCustomOpen(false);
  };

  return <View style={styles.root}>
    <View style={styles.heading}>
      <Text variant="labelLarge" color="secondary">App palette</Text>
      <Text variant="bodySmall" color="secondary">{overridden ? `Saved: ${appPaletteName(value)}` : appPaletteName(value)}</Text>
    </View>
    {overridden ? <Text variant="bodySmall" color="secondary" style={styles.hint}>
      Material You is on. Turn it off to use your palette.
    </Text> : null}
    <View {...keys} accessibilityRole="radiogroup" accessibilityLabel="App palette"
      style={styles.grid}>
      {options.map((option, index) => {
        const selected = option.seed === value;
        return <PressableScale key={option.seed} accessibilityRole="radio"
          accessibilityLabel={option.name} accessibilityState={{ checked: selected, disabled: overridden }}
          disabled={overridden}
          {...(Platform.OS === "web" ? { tabIndex: overridden ? -1 : selected || (custom && index === 0) ? 0 : -1 } : {})}
          onPress={() => choose(option.seed)} style={[styles.option, { width: `${100 / columns}%` }, overridden && styles.disabled]}>
          <View style={[styles.ring, { borderColor: selected ? palette.primary : "transparent" }]}>
            <PaletteSwatch colors={option.colors} selected={selected} />
          </View>
          <Text variant="labelMedium" color={selected ? "accent" : "secondary"} align="center" style={styles.optionLabel}>{option.name}</Text>
        </PressableScale>;
      })}
    </View>
    <View style={[styles.divider, { backgroundColor: palette.outlineVariant }]} />
    <PressableScale accessibilityRole="button" accessibilityLabel={custom ? `Custom color, ${value}` : "Custom color"}
      accessibilityState={{ disabled: overridden, expanded: customOpen }} disabled={overridden}
      onPress={openCustom} style={[styles.custom, overridden && styles.disabled]}>
      <MaterialIcon name="color-palette-outline" size={20} color={palette.primary} />
      <Text variant="labelLarge" style={styles.customLabel}>Custom color</Text>
      {custom ? <Text variant="bodySmall" color="secondary">{value}</Text> : null}
      <MaterialIcon name={custom ? "checkmark" : "add"} size={20} color={palette.primary} />
    </PressableScale>
    <FloatingPanel visible={customOpen} onDismiss={() => setCustomOpen(false)}>
      <PanelHeader title="Custom color" subtitle="Choose a starting color. ordo creates a matching palette for light and dark mode." />
      <View style={[styles.preview, { backgroundColor: preview.surfaceContainerLow }]}>
        <PaletteSwatch colors={preview} />
        <View style={styles.previewCopy}>
          <Text variant="titleMedium" style={{ color: preview.onSurface }}>Your palette</Text>
          <Text variant="bodySmall" style={{ color: preview.onSurfaceVariant }}>Adapts to your theme and contrast</Text>
        </View>
        <View style={[styles.previewAction, { backgroundColor: preview.primary }]}>
          <MaterialIcon name="checkmark" size={20} color={preview.onPrimary} />
        </View>
      </View>
      <Input label="Hex color" accessibilityLabel="Hex color" value={draft}
        onChangeText={(text) => { setDraft(text); setError(false); }}
        autoFocus autoCapitalize="characters" autoCorrect={false} spellCheck={false}
        placeholder="#7856A8" helper="Use 3 or 6 hex digits, for example #7856A8."
        error={error ? "Enter a valid color, like #7856A8 or #75A." : undefined}
        returnKeyType="done" onSubmitEditing={applyCustom} />
      <PanelActions confirmLabel="Use color" onConfirm={applyCustom} onCancel={() => setCustomOpen(false)} />
    </FloatingPanel>
  </View>;
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: layout.rowInset, paddingTop: spacing[16], paddingBottom: spacing[8] },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing[8], marginBottom: spacing[8] },
  hint: { marginBottom: spacing[8] },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  option: { minHeight: 88, alignItems: "center", justifyContent: "center", gap: spacing[4], borderRadius: radius.lg, paddingVertical: spacing[8] },
  optionLabel: { alignSelf: "stretch" },
  ring: { borderWidth: 2, borderRadius: radius.full, padding: spacing[4] },
  swatch: { width: 40, height: 40, borderRadius: radius.full, overflow: "hidden" },
  swatchSide: { width: "50%", alignSelf: "flex-end", flex: 1 },
  tone: { flex: 1 },
  check: { position: "absolute", width: 28, height: 28, top: 6, left: 6, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  divider: { height: StyleSheet.hairlineWidth, marginTop: spacing[8] },
  custom: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing[12], paddingVertical: spacing[8], paddingHorizontal: spacing[8], borderRadius: radius.sm },
  customLabel: { flex: 1, flexShrink: 1 },
  disabled: { opacity: 0.38 },
  preview: { flexDirection: "row", alignItems: "center", gap: spacing[16], borderRadius: radius.lg, padding: spacing[16], marginBottom: spacing[24] },
  previewCopy: { flex: 1 },
  previewAction: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
});
