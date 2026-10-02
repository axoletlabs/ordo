/**
 * Reader-specific theming.
 *
 * The reader surface renders with its own palette, independent of the app
 * theme, driven by the account-synced ReaderPreferences. Light/dark/AMOLED
 * reuse the app palettes; sepia is a dedicated warm-paper palette for long
 * reading sessions.
 */
import type { ReaderTheme } from "@ordo/shared";
import { resolvePalette, type Palette, type SystemColorScheme } from "./theme";
import type { DeviceTonalPalettes } from "./material-colors";

/** Sepia: aged-paper surfaces with deep umber ink and a terracotta accent. */
const sepia: Palette = {
  ...resolvePalette("light", false, "light", "#8B6500"),
  mode: "light",
  amoled: false,
  background: "#F2E8D5",
  surface: "#F7EFDF",
  surfaceSecondary: "#E9DEC6",
  surfaceElevated: "#FAF4E6",
  text: "#43351F",
  onSurface: "#43351F",
  onSurfaceVariant: "#57452B",
  textSecondary: "#57452B",
  textTertiary: "#57452B",
  textFaint: "#57452B",
  border: "rgba(67,53,31,0.12)",
  borderStrong: "rgba(67,53,31,0.20)",
  outline: "rgba(67,53,31,0.28)",
  overlay: "rgba(58,46,30,0.5)",
};

/** Resolve the effective reader palette. `system` tracks the OS scheme. */
export function resolveReaderPalette(
  theme: ReaderTheme,
  amoled: boolean,
  systemColorScheme: SystemColorScheme,
  appearance?: { seed?: string; expressive: boolean; contrast: 0 | 0.5 | 1; deviceColors?: DeviceTonalPalettes | null },
): Palette {
  if (theme === "sepia") {
    const generated = resolvePalette("light", false, "light", "#8B6500", appearance?.expressive, appearance?.contrast);
    return { ...generated, background: sepia.background, surface: sepia.surface, onSurface: sepia.onSurface,
      onSurfaceVariant: sepia.onSurfaceVariant, text: sepia.text, textSecondary: sepia.textSecondary,
      textTertiary: sepia.textTertiary, textFaint: sepia.textFaint };
  }
  return resolvePalette(theme, amoled, systemColorScheme, appearance?.seed, appearance?.expressive, appearance?.contrast, appearance?.deviceColors);
}
