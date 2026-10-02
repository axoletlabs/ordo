/** Pure Material color generation, shared by the theme and contrast verification. */
import { argbFromHex, hexFromArgb, Hct, SchemeExpressive, SchemeTonalSpot } from "@material/material-color-utilities";
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
export function materialColorRoles(seed: string, dark: boolean, expressive: boolean, contrast: 0 | 0.5 | 1): MaterialColors {
  const source = Hct.fromInt(argbFromHex(seed));
  const scheme = expressive ? new SchemeExpressive(source, dark, contrast) : new SchemeTonalSpot(source, dark, contrast);
  return Object.fromEntries(MATERIAL_ROLES.map((role) => [role, hexFromArgb(scheme[role])])) as MaterialColors;
}
