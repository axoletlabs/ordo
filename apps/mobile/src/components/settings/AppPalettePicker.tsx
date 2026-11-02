import React, { useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useRadioGroupKeys } from "../../hooks/use-radio-group-keys";
import { haptics } from "../../lib/haptics";
import { clampHsv, hexToHsv, hsvToHex, type Hsv } from "../../lib/hsv-color";
import { useSettingsStore } from "../../store/settings";
import { APP_PALETTES, appPaletteName, normalizeAppColor } from "../../theme/app-colors";
import { materialYouAvailable, useDeviceColors } from "../../theme/device-colors";
import { materialColorRoles, type MaterialColors } from "../../theme/material-colors";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import { FloatingPanel } from "../ui/FloatingPanel";
import { HsvColorPicker } from "../ui/HsvColorPicker";
import { Input } from "../ui/Input";
import { MaterialIcon } from "../ui/MaterialIcon";
import { PanelHeader } from "../ui/PanelHeader";
import { PressableScale } from "../ui/PressableScale";
import { PanelActions } from "../ui/SheetActionRow";
import { Text } from "../ui/Text";

const WALLPAPER = "wallpaper";
const CUSTOM = "custom";
const seeds = APP_PALETTES.map((option) => option.seed);

/** A miniature of the generated palette, rather than the unadjusted seed. */
function PaletteSwatch({ colors, selected = false, icon, fallback, iconColor }: {
  colors?: MaterialColors;
  selected?: boolean;
  icon?: React.ComponentProps<typeof MaterialIcon>["name"];
  fallback?: string;
  iconColor?: string;
}) {
  return <View accessible={false} style={[styles.swatch, { backgroundColor: colors?.primary ?? fallback ?? "transparent" }]}>
    {colors ? <View style={styles.swatchSide}>
      <View style={[styles.tone, { backgroundColor: colors.secondaryContainer }]} />
      <View style={[styles.tone, { backgroundColor: colors.tertiary }]} />
    </View> : null}
    {selected ? <View style={[styles.check, { backgroundColor: colors?.primary ?? fallback ?? "transparent" }]}>
      <MaterialIcon name="checkmark" size={16} color={colors?.onPrimary ?? iconColor ?? "#fff"} />
    </View> : icon ? <MaterialIcon name={icon} size={16} color={iconColor} /> : null}
  </View>;
}

export function AppPalettePicker({ value, onChange }: {
  value: string;
  onChange: (color: string) => void;
}) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const contrast = useSettingsStore((state) => state.themeContrast);
  const materialYou = useSettingsStore((state) => state.materialYouColors);
  const setMaterialYouColors = useSettingsStore((state) => state.setMaterialYouColors);
  const deviceColors = useDeviceColors();
  const wallpaperOn = materialYou && materialYouAvailable;
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 174, s: 1, v: 0.42 });
  const hexFocused = useRef(false);
  const dark = palette.mode === "dark";
  const options = useMemo(() => APP_PALETTES.map((option) => ({
    ...option, colors: materialColorRoles(option.seed, dark, false, contrast),
  })), [dark, contrast]);
  const wallpaperColors = useMemo(
    () => deviceColors ? materialColorRoles(value, dark, false, contrast, deviceColors) : null,
    [deviceColors, value, dark, contrast],
  );
  const custom = appPaletteName(value) === "Custom";
  const customColors = useMemo(
    () => custom ? materialColorRoles(value, dark, false, contrast) : null,
    [custom, value, dark, contrast],
  );
  const selectedKey = wallpaperOn ? WALLPAPER : custom ? CUSTOM : value;
  const keys = [
    ...(materialYouAvailable ? [WALLPAPER] : []),
    ...seeds,
    CUSTOM,
  ];
  const [gridWidth, setGridWidth] = useState(0);
  const columns = gridWidth > 0
    ? Math.max(1, Math.floor((gridWidth + spacing[4]) / (layout.touchTargetMin + spacing[4])))
    : width >= 768 ? keys.length : 5;
  const previewSeed = normalizeAppColor(draft) ?? hsvToHex(hsv);
  const preview = useMemo(() => materialColorRoles(previewSeed, dark, false, contrast),
    [previewSeed, dark, contrast]);

  const applySeed = (seed: string) => {
    if (wallpaperOn) setMaterialYouColors(false);
    if (seed === value && !wallpaperOn) return;
    haptics.selection();
    if (seed !== value) onChange(seed);
  };
  const selectKey = (key: string) => {
    if (key === CUSTOM) return;
    if (key === WALLPAPER) {
      if (!materialYouAvailable || wallpaperOn) return;
      haptics.selection();
      setMaterialYouColors(true);
      return;
    }
    applySeed(key);
  };
  const radioKeys = useRadioGroupKeys(keys, selectKey, columns);
  const openCustom = () => {
    setHsv(hexToHsv(value) ?? { h: 174, s: 1, v: 0.42 });
    setDraft(value);
    setCustomOpen(true);
    haptics.selection();
  };
  const updateHsv = (next: Hsv) => {
    const nextHsv = clampHsv(next);
    setHsv(nextHsv);
    if (!hexFocused.current) setDraft(hsvToHex(nextHsv));
  };
  const applyCustom = () => {
    applySeed(normalizeAppColor(draft) ?? hsvToHex(hsv));
    setCustomOpen(false);
  };

  return <View style={styles.root}>
    <View style={styles.heading}>
      <Text variant="labelLarge" color="secondary">App palette</Text>
      <Text variant="bodySmall" color="secondary">{wallpaperOn ? "Wallpaper" : appPaletteName(value)}</Text>
    </View>
    <View {...radioKeys} accessibilityRole="radiogroup" accessibilityLabel="App palette" style={styles.grid}
      onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
      {materialYouAvailable ? <PressableScale accessibilityRole="radio" accessibilityLabel="Wallpaper, Material You"
        accessibilityHint="Use colors from your Android wallpaper."
        accessibilityState={{ checked: selectedKey === WALLPAPER }}
        {...(Platform.OS === "web" ? { tabIndex: selectedKey === WALLPAPER ? 0 : -1 } : {})}
        onPress={() => selectKey(WALLPAPER)} style={styles.option}>
        <View style={[styles.ring, { borderColor: selectedKey === WALLPAPER ? palette.primary : "transparent" }]}>
          <PaletteSwatch colors={wallpaperColors ?? undefined} selected={selectedKey === WALLPAPER}
            icon={wallpaperColors ? undefined : "images-outline"}
            fallback={palette.surfaceContainerHighest} iconColor={palette.onSurfaceVariant} />
        </View>
      </PressableScale> : null}
      {options.map((option) => {
        const selected = selectedKey === option.seed;
        return <PressableScale key={option.seed} accessibilityRole="radio"
          accessibilityLabel={option.name} accessibilityState={{ checked: selected }}
          {...(Platform.OS === "web" ? { tabIndex: selected ? 0 : -1 } : {})}
          onPress={() => selectKey(option.seed)} style={styles.option}>
          <View style={[styles.ring, { borderColor: selected ? palette.primary : "transparent" }]}>
            <PaletteSwatch colors={option.colors} selected={selected} />
          </View>
        </PressableScale>;
      })}
      <PressableScale accessibilityRole="radio"
        accessibilityLabel={custom ? `Custom color, ${value}` : "Custom color"}
        accessibilityHint="Opens the color picker."
        accessibilityState={{ checked: selectedKey === CUSTOM, expanded: customOpen }}
        {...(Platform.OS === "web" ? { tabIndex: selectedKey === CUSTOM ? 0 : -1 } : {})}
        onPress={openCustom} style={styles.option}>
        <View style={[styles.ring, { borderColor: selectedKey === CUSTOM ? palette.primary : "transparent" }]}>
          {customColors ? <PaletteSwatch colors={customColors} selected={selectedKey === CUSTOM} />
            : <View style={[styles.swatch, { backgroundColor: palette.surfaceContainerHighest, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.outlineVariant }]}>
              <MaterialIcon name="color-palette-outline" size={16} color={palette.primary} />
            </View>}
        </View>
      </PressableScale>
    </View>
    <FloatingPanel visible={customOpen} onDismiss={() => setCustomOpen(false)}>
      <PanelHeader title="Custom color" subtitle="ordo builds matching light and dark palettes from this color." />
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
      <HsvColorPicker value={hsv} onChange={updateHsv} />
      <Input label="Hex" accessibilityLabel="Hex color" value={draft} mono
        onChangeText={(text) => {
          setDraft(text);
          const next = hexToHsv(text);
          if (next) setHsv(next);
        }}
        onFocus={() => { hexFocused.current = true; }}
        onBlur={() => { hexFocused.current = false; }}
        autoCapitalize="characters" autoCorrect={false} spellCheck={false}
        placeholder="#7856A8" helper="Or paste a 3 or 6 digit hex color."
        returnKeyType="done" onSubmitEditing={applyCustom} containerStyle={styles.hex} />
      <PanelActions confirmLabel="Use color" onConfirm={applyCustom} onCancel={() => setCustomOpen(false)} />
    </FloatingPanel>
  </View>;
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: layout.rowInset, paddingTop: spacing[16], paddingBottom: spacing[8] },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing[8], marginBottom: spacing[8] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[4] },
  option: { width: layout.touchTargetMin, minHeight: layout.touchTargetMin, alignItems: "center", justifyContent: "center", borderRadius: radius.lg },
  ring: { borderWidth: 2, borderRadius: radius.full, padding: spacing[2] },
  swatch: { width: 32, height: 32, borderRadius: radius.full, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  swatchSide: { width: "50%", alignSelf: "flex-end", flex: 1 },
  tone: { flex: 1 },
  check: { position: "absolute", top: 6, left: 6, width: 20, height: 20, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  preview: { flexDirection: "row", alignItems: "center", gap: spacing[16], borderRadius: radius.lg, padding: spacing[12], marginBottom: spacing[16] },
  previewCopy: { flex: 1 },
  previewAction: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  hex: { marginTop: spacing[16] },
});
