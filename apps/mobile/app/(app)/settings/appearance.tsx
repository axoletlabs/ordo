/** Material color, contrast, and globally switched Expressive component/motion scheme. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { SettingsGroup, SettingsPage, SettingsScrollView } from "../../../src/components/settings/SettingsPage";
import { SettingsSelect, type SettingsSelectOption } from "../../../src/components/settings/SettingsSelect";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Toggle } from "../../../src/components/ui/Toggle";
import { Text } from "../../../src/components/ui/Text";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { MaterialIcon } from "../../../src/components/ui/MaterialIcon";
import { Segmented } from "../../../src/components/ui/Segmented";
import { useSettingsStore, type NavigationAnimation } from "../../../src/store/settings";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { resolvePalette, type ThemeMode } from "../../../src/theme/theme";
import { layout, radius, spacing } from "../../../src/theme/tokens";

const themeOptions: readonly SettingsSelectOption<ThemeMode>[] = [
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
  { value: "system", label: "System", icon: "desktop-outline" },
];
const animationOptions: readonly SettingsSelectOption<NavigationAnimation>[] = [
  { value: "slide", label: "Slide", icon: "arrow-forward-outline" },
  { value: "fade", label: "Fade", icon: "layers-outline" },
  { value: "instant", label: "Instant", icon: "flash-outline" },
];
const seeds = [
  { label: "Teal", value: "#006A60" }, { label: "Violet", value: "#6750A4" },
  { label: "Blue", value: "#005AC1" }, { label: "Rose", value: "#984061" }, { label: "Green", value: "#386A20" },
] as const;
const contrasts = [
  { value: "0", label: "Standard" }, { value: "0.5", label: "Medium" }, { value: "1", label: "High" },
] as const;

export default function AppearanceScreen() {
  const { palette, expressive } = useTheme();
  const settings = useSettingsStore();
  const dark = palette.mode === "dark";
  return <SettingsPage title="Appearance">
    <SettingsScrollView>
      <View style={[styles.preview, { backgroundColor: palette.primaryContainer, borderRadius: expressive ? radius["3xl"] : radius["2xl"] }]}>
        <View style={[styles.previewIcon, { backgroundColor: palette.tertiaryContainer, borderRadius: expressive ? radius.xl : radius.full }]}>
          <MaterialIcon name="sparkles-outline" size={32} color={palette.onTertiaryContainer} />
        </View>
        <Text variant={expressive ? "headlineLarge" : "headlineMedium"} style={{ color: palette.onPrimaryContainer }}>
          {expressive ? "Material 3 Expressive" : "Material 3"}
        </Text>
        <Text variant="bodyMedium" style={{ color: palette.onPrimaryContainer }}>
          {expressive ? "Emphasized type, contrasting shapes, and responsive spring motion." : "Tonal surfaces, rounded controls, and restrained motion."}
        </Text>
      </View>
      <SettingsGroup label="Design">
        <SettingRow icon="sparkles-outline" label="Expressive" description="Changes shapes, typography, lists, menus, and motion throughout the app."
          rightFit="content" right={<Toggle value={expressive} onValueChange={settings.setExpressive} accessibilityLabel="Material 3 Expressive" />} />
      </SettingsGroup>
      <SettingsGroup label="Color" footer="Each source generates a complete palette. Expressive uses contrasting color families.">
        <SettingRow icon="color-palette-outline" label="Theme" right={<SettingsSelect title="Theme" options={themeOptions} value={settings.themeMode} onChange={settings.setThemeMode} />} />
        <View style={styles.colorOptions} accessibilityRole="radiogroup" accessibilityLabel="Theme color">
          {seeds.map((seed) => {
            const p = resolvePalette(palette.mode, false, palette.mode, seed.value, expressive, settings.themeContrast);
            const selected = settings.themeSeed === seed.value;
            return <View key={seed.value} style={{ alignItems: "center", gap: spacing[8], flex: 1 }}>
              <PressableScale accessibilityRole="radio" accessibilityLabel={seed.label} accessibilityState={{ checked: selected }}
                onPress={() => settings.setThemeSeed(seed.value)} stateLayerColor={p.onPrimaryContainer}
                shape={{ rest: selected && expressive ? radius.lg : 24, pressed: expressive ? radius.md : 24 }}
                style={[styles.swatch, { backgroundColor: p.primaryContainer, borderColor: selected ? palette.primary : "transparent" }]}>
                <View style={[styles.swatchHalf, { backgroundColor: p.tertiaryContainer }]} />
                {selected ? <MaterialIcon name="checkmark" size={24} color={p.onPrimaryContainer} /> : null}
              </PressableScale>
              <Text variant="labelMedium" color="secondary">{seed.label}</Text>
            </View>;
          })}
        </View>
        <Text variant="labelLarge" color="secondary" style={styles.controlLabel}>Contrast</Text>
        <View style={styles.contrast}>
          <Segmented options={contrasts} value={String(settings.themeContrast)} onChange={(value) => settings.setThemeContrast(Number(value) as 0 | 0.5 | 1)} />
        </View>
        <SettingRow icon="contrast-outline" label="AMOLED black" description={dark ? "Pure black page background" : "Available in dark mode"}
          rightFit="content" right={<Toggle value={settings.amoled && dark} onValueChange={settings.setAmoled} disabled={!dark} accessibilityLabel="AMOLED black" />} />
      </SettingsGroup>
      <SettingsGroup label="Motion and feedback" footer="Animations follow your device’s reduced-motion preference.">
        <SettingRow icon="swap-horizontal-outline" label="Page transitions" right={<SettingsSelect title="Page transitions" options={animationOptions} value={settings.navigationAnimation} onChange={settings.setNavigationAnimation} />} />
        <SettingRow icon="pulse-outline" label="Haptic feedback" rightFit="content" right={<Toggle value={settings.hapticsEnabled} onValueChange={settings.setHapticsEnabled} accessibilityLabel="Haptic feedback" />} />
      </SettingsGroup>
    </SettingsScrollView>
  </SettingsPage>;
}
const styles = StyleSheet.create({
  preview: { padding: spacing[24], gap: spacing[16], marginTop: spacing[8] },
  previewIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  colorOptions: { flexDirection: "row", paddingVertical: spacing[24], gap: spacing[8] },
  swatch: { width: 48, height: 48, borderWidth: 2, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  swatchHalf: { position: "absolute", top: 0, right: 0, width: 22, height: 48 },
  controlLabel: { paddingHorizontal: layout.rowInset, paddingBottom: spacing[8] },
  contrast: { paddingHorizontal: layout.rowInset, paddingBottom: spacing[16] },
});
