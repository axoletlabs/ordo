/** Material 3 type scale. Legacy semantic names map to Material roles. */
import React from "react";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { resolveFont } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

const typescale = {
  displayLarge: [57, 64, "400", -0.25], displayMedium: [45, 52, "400", 0], displaySmall: [36, 44, "400", 0],
  headlineLarge: [32, 40, "400", 0], headlineMedium: [28, 36, "400", 0], headlineSmall: [24, 32, "400", 0],
  titleLarge: [22, 28, "400", 0], titleMedium: [16, 24, "500", 0.15], titleSmall: [14, 20, "500", 0.1],
  bodyLarge: [16, 24, "400", 0.5], bodyMedium: [14, 20, "400", 0.25], bodySmall: [12, 16, "400", 0.4],
  labelLarge: [14, 20, "500", 0.1], labelMedium: [12, 16, "500", 0.5], labelSmall: [11, 16, "500", 0.5],
} as const;
type MaterialType = keyof typeof typescale;
const aliases = {
  wordmark: "displaySmall", display: "displaySmall", title1: "headlineLarge", title2: "headlineSmall",
  title3: "titleLarge", headline: "titleMedium", header: "titleLarge", body: "bodyLarge",
  bodyStrong: "bodyLarge", callout: "bodyLarge", subhead: "titleSmall", footnote: "bodyMedium",
  caption: "labelMedium", label: "labelLarge", mono: "bodyMedium", monoSmall: "bodySmall",
} as const satisfies Record<string, MaterialType>;
export type TextVariant = MaterialType | keyof typeof aliases;
export type TextColor = "primary" | "secondary" | "tertiary" | "faint" | "accent" | "onAccent" | "coral" | "green" | "blue" | "mustard" | "danger";
export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  align?: "auto" | "left" | "center" | "right" | "justify";
}
export const NAV_CHROME_TEXT = {
  fontFamily: resolveFont("sans", "500"), fontSize: 12, fontWeight: "500" as const, lineHeight: 16, letterSpacing: 0.5,
};
export const Text = React.forwardRef<RNText, TextProps>(function Text({ variant = "body", color = "primary", align, style, ...rest }, ref) {
  const { palette, expressive } = useTheme();
  const role = variant in aliases ? aliases[variant as keyof typeof aliases] : variant as MaterialType;
  const [fontSize, lineHeight, baseWeight, letterSpacing] = typescale[role];
  const emphasized = expressive && (role.startsWith("display") || role.startsWith("headline"));
  const weight = variant === "bodyStrong" ? "700" : emphasized ? "500" : baseWeight;
  const colors = {
    primary: palette.onSurface, secondary: palette.onSurfaceVariant, tertiary: palette.onSurfaceVariant,
    faint: palette.onSurfaceVariant, accent: palette.primary, onAccent: palette.onPrimary,
    coral: palette.error, green: palette.primary, blue: palette.secondary, mustard: palette.tertiary, danger: palette.error,
  };
  return <RNText ref={ref} {...rest} style={[{
    color: colors[color], fontFamily: resolveFont("sans", weight), fontSize, lineHeight,
    fontWeight: weight as TextStyle["fontWeight"], letterSpacing, textAlign: align, includeFontPadding: false,
  }, style]} />;
});
