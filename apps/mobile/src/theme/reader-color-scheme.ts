import type { ReaderTheme } from "@ordo/shared";

/**
 * Native appearance override while the reader is on screen.
 *
 * Light and sepia must force light so Android night-mode cannot invert
 * parchment. Dark forces dark. System must stay `unspecified` — pinning the
 * already-resolved light/dark mode writes that mode back into
 * `useColorScheme`, which resolves the palette again and flashes forever
 * after leaving sepia (sepia had forced light over a dark OS scheme).
 */
export function readerColorSchemeOverride(
  theme: ReaderTheme,
): "light" | "dark" | "unspecified" {
  if (theme === "dark") return "dark";
  if (theme === "light" || theme === "sepia") return "light";
  return "unspecified";
}
