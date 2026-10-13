import type { ReaderTheme } from "@ordo/shared";

/**
 * Reader palettes and system-bar styling never override the device's
 * appearance signal. Force-dark is disabled by the native build plugin.
 */
export function readerColorSchemeOverride(
  _theme: ReaderTheme,
): "light" | "dark" | "unspecified" {
  return "unspecified";
}
