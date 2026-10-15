/** Material icons with an adapter for persisted folder names and existing action APIs. */
import React from "react";
import type LegacyIcons from "@expo/vector-icons/Ionicons";
import createIconSet from "@expo/vector-icons/createIconSet";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { useTheme } from "../../theme/ThemeProvider";
import { MATERIAL_ICON_GLYPHS } from "../../theme/material-icon-glyphs";
import { resolveMaterialIconName } from "../../theme/material-icon-names";
import materialIconFont from "../../../assets/fonts/MaterialIcons-Ordo.ttf";
type Name = keyof typeof LegacyIcons.glyphMap;

// Material Icons cut down to the glyphs the app references (~18 KB instead of
// ~350 KB). Regenerate with scripts/build-icon-font.mjs after adding an icon.
const MaterialIcons = createIconSet(MATERIAL_ICON_GLYPHS, "ordo-material-icons", materialIconFont);
const hasGlyph = (material: string) => material in MATERIAL_ICON_GLYPHS;
export function materialIconName(name: string): string {
  return resolveMaterialIconName(name, hasGlyph);
}
export function MaterialIcon({ name, size = 24, color, style, accessible = false, ...props }: Omit<React.ComponentProps<typeof LegacyIcons>, "name"> & { name: Name }) {
  const { palette } = useTheme();
  const material = materialIconName(name);
  return <View {...props} accessible={accessible} aria-hidden={!accessible} style={[{ width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }, style as StyleProp<ViewStyle>]}>
    <MaterialIcons name={material} size={size} color={color ?? palette.onSurfaceVariant} accessible={false} style={iconGlyphStyle(size)} />
  </View>;
}
// The adapter preserves the public type accepted by stored folder DTOs.
MaterialIcon.glyphMap = MATERIAL_ICON_GLYPHS as unknown as typeof LegacyIcons.glyphMap;
/** Font source for preloading (see launchFonts in theme/fonts). */
MaterialIcon.font = MaterialIcons.font;
