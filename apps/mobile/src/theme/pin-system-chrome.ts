import { Platform, StatusBar } from "react-native";
import * as SystemUI from "expo-system-ui";
import { systemChromeForPalette } from "./system-chrome";
import type { Palette } from "./theme";

/** Keep the activity window the same color as the running theme. */
export async function pinWindowBackground(color: string): Promise<void> {
  await SystemUI.setBackgroundColorAsync(color);
}

/**
 * Write the theme into RN's StatusBar *defaults* and the native window so a
 * full tree unmount (OTA reload) restores matching chrome, not the light splash.
 */
export async function pinSystemChrome(
  palette: Pick<Palette, "mode" | "background">,
): Promise<void> {
  try {
    const chrome = systemChromeForPalette(palette);
    if (Platform.OS === "android") {
      StatusBar.setTranslucent(chrome.translucent);
      StatusBar.setBackgroundColor(chrome.backgroundColor);
    }
    if (Platform.OS !== "web") {
      StatusBar.setBarStyle(chrome.barStyle);
    }
    await pinWindowBackground(chrome.backgroundColor);
  } catch {
    // Reload must still proceed; unmatched chrome is better than a stuck update.
  }
}
