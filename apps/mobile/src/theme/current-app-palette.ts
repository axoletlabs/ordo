import { Appearance } from "react-native";
import { useSettingsStore } from "../store/settings";
import { currentDeviceColors } from "./device-colors";
import { resolvePalette, type ThemeMode } from "./theme";

/** Native chrome handoffs must preserve the same color inputs as ThemeProvider. */
export function currentAppPalette(mode?: ThemeMode) {
  const { themeMode, amoled, expressive, themeContrast, materialYouColors } = useSettingsStore.getState();
  return resolvePalette(mode ?? themeMode, amoled, Appearance.getColorScheme(), undefined,
    expressive, themeContrast, materialYouColors ? currentDeviceColors() : null);
}
