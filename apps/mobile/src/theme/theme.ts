/** Google's Material 3 generated color roles, with compatibility aliases. */
import { APP_COLOR, materialColorRoles, type DeviceTonalPalettes, type MaterialColors } from "./material-colors";
export type { MaterialColors } from "./material-colors";
import { makeShadow, type Shadow } from "./tokens";

export type ThemeMode = "light" | "dark" | "system";
export interface Palette extends MaterialColors {
  mode: "light" | "dark"; amoled: boolean;
  background: string; surfaceSecondary: string; surfaceElevated: string;
  text: string; textSecondary: string; textTertiary: string; textFaint: string;
  border: string; borderStrong: string;
  accent: string; onAccent: string; accentSoft: string;
  coral: string; green: string; blue: string; mustard: string;
  success: string; warning: string; danger: string; dangerSoft: string; overlay: string;
}

export type SystemColorScheme = "light" | "dark" | "unspecified" | null | undefined;

const cache = new Map<string, Palette>();

export function resolvePalette(
  mode: ThemeMode,
  amoled: boolean,
  systemColorScheme: SystemColorScheme,
  seed = APP_COLOR,
  expressive = false,
  contrast: 0 | 0.5 | 1 = 0,
  device?: DeviceTonalPalettes | null,
): Palette {
  const isDark = mode === "dark" || (mode === "system" && systemColorScheme === "dark");
  const key = `${isDark}:${amoled}:${seed}:${contrast}:${device ? JSON.stringify(device) : "app"}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const roles = materialColorRoles(seed, isDark, expressive, contrast, device);
  const palette: Palette = {
    ...roles,
    mode: isDark ? "dark" : "light", amoled: isDark && amoled,
    background: isDark && amoled ? "#000000" : roles.surface,
    surfaceSecondary: roles.surfaceContainerHigh, surfaceElevated: roles.surfaceContainerHigh,
    text: roles.onSurface, textSecondary: roles.onSurfaceVariant,
    textTertiary: roles.onSurfaceVariant, textFaint: roles.onSurfaceVariant,
    border: roles.outlineVariant, borderStrong: roles.outline,
    accent: roles.primary, onAccent: roles.onPrimary, accentSoft: roles.primaryContainer,
    coral: roles.error, green: roles.primary, blue: roles.secondary, mustard: roles.tertiary,
    success: roles.primary, warning: roles.tertiary, danger: roles.error, dangerSoft: roles.errorContainer,
    overlay: `${roles.scrim}52`,
  };
  // Bound the cache even when callers supply custom colors.
  if (cache.size > 64) cache.clear();
  cache.set(key, palette);
  return palette;
}

export interface Shadows { level1: Shadow; level2: Shadow; level3: Shadow }
export function resolveShadows(p: Palette): Shadows {
  return { level1: makeShadow(p.scrim, 1), level2: makeShadow(p.scrim, 2), level3: makeShadow(p.scrim, 3) };
}
