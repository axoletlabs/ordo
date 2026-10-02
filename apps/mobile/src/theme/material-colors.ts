/** Pure Material color generation, shared by the theme and contrast verification. */
import { argbFromHex, DynamicScheme, hexFromArgb, Hct, SchemeTonalSpot, TonalPalette } from "@material/material-color-utilities";
export const APP_COLOR = "#006A60";
export type DeviceTonalFamily = "accent1" | "accent2" | "accent3" | "neutral1" | "neutral2";
export type DeviceTonalPalettes = Record<DeviceTonalFamily, Record<string, string>> & {
  legacyNeutral?: boolean;
  schemes?: { light?: Partial<MaterialColors>; dark?: Partial<MaterialColors> };
};
export const MATERIAL_ROLES = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "surface", "onSurface", "onSurfaceVariant", "surfaceContainerLowest", "surfaceContainerLow",
  "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest", "surfaceDim", "surfaceBright",
  "outline", "outlineVariant", "inverseSurface", "inverseOnSurface", "inversePrimary", "scrim",
] as const;
export type MaterialColors = Record<typeof MATERIAL_ROLES[number], string>;
/** Expressive components do not require the unrelated Expressive color variant. */
export function materialColorRoles(seed: string, dark: boolean, _expressive: boolean, contrast: 0 | 0.5 | 1, device?: DeviceTonalPalettes | null): MaterialColors {
  const source = Hct.fromInt(argbFromHex(seed));
  const appScheme = new SchemeTonalSpot(source, dark, contrast);
  const scheme = device ? new DynamicScheme({
    sourceColorArgb: argbFromHex(device.accent1["50"]!), variant: appScheme.variant,
    isDark: dark, contrastLevel: contrast,
    primaryPalette: devicePalette(device.accent1), secondaryPalette: devicePalette(device.accent2),
    tertiaryPalette: devicePalette(device.accent3), neutralPalette: devicePalette(device.legacyNeutral ? device.neutral2 : device.neutral1),
    neutralVariantPalette: devicePalette(device.neutral2),
  }) : appScheme;
  const roles = Object.fromEntries(MATERIAL_ROLES.map((role) => [role, hexFromArgb(scheme[role])])) as MaterialColors;
  const system = device?.schemes?.[dark ? "dark" : "light"];
  // Android 14+ exposes the exact semantic scheme, including monochrome and
  // system contrast choices. Explicit app contrast levels still use MCU.
  if (contrast === 0 && system) {
    for (const role of MATERIAL_ROLES) {
      const color = system[role];
      if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) roles[role] = color;
    }
  }
  return roles;
}

function devicePalette(tones: Record<string, string>): TonalPalette {
  const palette = TonalPalette.fromInt(argbFromHex(tones["50"]!));
  const generatedTone = palette.tone.bind(palette);
  // Preserve Android's actual user-selected palettes (including vibrant,
  // neutral, and monochrome choices); derive only the additional M3 tones.
  palette.tone = (tone) => tones[String(tone)] ? argbFromHex(tones[String(tone)]!) : generatedTone(tone);
  return palette;
}
