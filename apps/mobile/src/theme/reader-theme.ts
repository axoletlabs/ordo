/**
 * Reader-specific theming.
 *
 * The reader surface renders with its own palette, independent of the app
 * theme, driven by the account-synced ReaderPreferences. Light/dark/AMOLED
 * reuse the generated app palettes. Legacy Sepia preferences normalize to
 * System at the shared preference boundary.
 */
import type { ReaderTheme } from "@ordo/shared";
import { resolvePalette, type Palette, type SystemColorScheme } from "./theme";
import type { DeviceTonalPalettes } from "./material-colors";

/** Resolve the effective reader palette. `system` tracks the OS scheme. */
export function resolveReaderPalette(
  theme: ReaderTheme,
  amoled: boolean,
  systemColorScheme: SystemColorScheme,
  appearance?: { seed?: string; expressive: boolean; contrast: 0 | 0.5 | 1; deviceColors?: DeviceTonalPalettes | null },
): Palette {
  return resolvePalette(theme, amoled, systemColorScheme, appearance?.seed, appearance?.expressive, appearance?.contrast, appearance?.deviceColors);
}
