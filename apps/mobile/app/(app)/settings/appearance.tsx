/** Material color, contrast, and globally switched Expressive component/motion scheme. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { SettingsGroup, SettingsPage, SettingsScrollView } from "../../../src/components/settings/SettingsPage";
import { SettingsSelect, type SettingsSelectOption } from "../../../src/components/settings/SettingsSelect";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Toggle } from "../../../src/components/ui/Toggle";
import { Text } from "../../../src/components/ui/Text";
import { Segmented } from "../../../src/components/ui/Segmented";
import { useSettingsStore, type NavigationAnimation } from "../../../src/store/settings";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { type ThemeMode } from "../../../src/theme/theme";
import { materialYouAvailable } from "../../../src/theme/device-colors";
import { layout, spacing } from "../../../src/theme/tokens";

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
const contrasts = [
  { value: "0", label: "Standard" }, { value: "0.5", label: "Medium" }, { value: "1", label: "High" },
] as const;

export default function AppearanceScreen() {
  const { palette, expressive } = useTheme();
  const settings = useSettingsStore();
  const dark = palette.mode === "dark";
  return <SettingsPage title="Appearance">
    <SettingsScrollView>
      <SettingsGroup label="Design" compact>
        <SettingRow icon="sparkles-outline" label="Expressive" description="Changes shapes, typography, lists, menus, and motion throughout the app."
          rightFit="content" right={<Toggle value={expressive} onValueChange={settings.setExpressive} accessibilityLabel="Material 3 Expressive" />} />
      </SettingsGroup>
      <SettingsGroup label="Color">
        <SettingRow icon="color-palette-outline" label="Theme" right={<SettingsSelect title="Theme" options={themeOptions} value={settings.themeMode} onChange={settings.setThemeMode} />} />
        <SettingRow icon="color-fill-outline" label="Material You colors"
          description={materialYouAvailable ? "Use your device’s wallpaper and color settings. Turn off to use ordo’s colors." : "Available on Android 12 and later. This device uses ordo’s colors."}
          rightFit="content" right={<Toggle value={settings.materialYouColors && materialYouAvailable} disabled={!materialYouAvailable} onValueChange={settings.setMaterialYouColors} accessibilityLabel="Material You colors" />} />
        <Text variant="labelLarge" color="secondary" style={styles.controlLabel}>Contrast</Text>
        <View style={styles.contrast}>
          <Segmented options={contrasts} value={String(settings.themeContrast)} onChange={(value) => settings.setThemeContrast(Number(value) as 0 | 0.5 | 1)} />
          <Text variant="bodySmall" color="secondary" style={{ marginTop: spacing[8] }}>
            {settings.themeContrast === 0 ? "Default contrast for text, icons, and outlines." : settings.themeContrast === 0.5 ? "Stronger text, icons, and outlines for easier reading." : "Maximum contrast for text, icons, and outlines."} Light and dark modes stay the same.
          </Text>
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
  controlLabel: { paddingHorizontal: layout.rowInset, paddingTop: spacing[16], paddingBottom: spacing[8] },
  contrast: { paddingHorizontal: layout.rowInset, paddingBottom: spacing[16] },
});
