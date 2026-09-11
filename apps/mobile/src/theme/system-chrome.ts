/**
 * Native window / status-bar chrome that must survive a JS runtime reload.
 *
 * `Updates.reloadAsync()` tears down every React `StatusBar`. RN then restores
 * the Android theme defaults, which expo-splash-screen stamps as the *light*
 * splash color — an opaque cream strip over a dark window. Pinning the fallback
 * and the window background to the active palette keeps that gap invisible.
 */
import type { Palette } from "./theme";

export interface SystemChrome {
  backgroundColor: string;
  barStyle: "light-content" | "dark-content";
  translucent: true;
}

export function systemChromeForPalette(
  palette: Pick<Palette, "mode" | "background">,
): SystemChrome {
  return {
    backgroundColor: palette.background,
    barStyle: palette.mode === "dark" ? "light-content" : "dark-content",
    translucent: true,
  };
}
