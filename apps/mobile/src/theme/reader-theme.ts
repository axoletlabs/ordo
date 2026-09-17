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

/** Sepia: aged-paper surfaces with deep umber ink and a terracotta accent. */
const sepia: Palette = {
  mode: "light",
  amoled: false,
  background: "#F2E8D5",
  surface: "#F7EFDF",
  surfaceSecondary: "#E9DEC6",
  surfaceElevated: "#FAF4E6",
  text: "#43351F",
  textSecondary: "#57452B",
  textTertiary: "#7C6A4E",
  textFaint: "#A69474",
  border: "rgba(67,53,31,0.12)",
  borderStrong: "rgba(67,53,31,0.20)",
  outline: "rgba(67,53,31,0.28)",
  accent: "#C0653F",
  onAccent: "#FFFFFF",
  accentSoft: "rgba(192,101,63,0.14)",
  coral: "#C0653F",
  green: "#6C8F3A",
  blue: "#4F7DA6",
  mustard: "#C7952E",
  success: "#6C8F3A",
  warning: "#C7952E",
  danger: "#B84A35",
  dangerSoft: "rgba(184,74,53,0.12)",
  overlay: "rgba(58,46,30,0.5)",
};

/** Resolve the effective reader palette. `system` tracks the OS scheme. */
export function resolveReaderPalette(
  theme: ReaderTheme,
  amoled: boolean,
  systemColorScheme: SystemColorScheme,
): Palette {
  if (theme === "sepia") return sepia;
  return resolvePalette(theme, amoled, systemColorScheme);
}
