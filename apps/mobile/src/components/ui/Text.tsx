/**
 * Themed Text with typographic presets faithful to ordo-archive:
 *  - Inter Tight (`display`) for chrome, list names, and compact labels
 *  - Inter (`sans`) for body, hints, and supporting copy
 *  - JetBrains Mono for URLs, counts, timestamps, and codes
 *  - Playfair Display for the wordmark
 *
 * Roles:
 *  wordmark          App name
 *  display / title*  Page and empty-state titles (sentence case)
 *  headline          Bookmark, folder, and tag names in lists
 *  header            Screen titles, buttons, overlay titles (uppercase)
 *  body / bodyStrong Prose and setting-row names
 *  callout / subhead Rare emphasis; prefer body / bodyStrong
 *  footnote          Supporting copy, errors, descriptions
 *  caption           Compact Tight chrome that is not uppercase
 *  label             Field labels, section labels, compact actions (uppercase)
 *  mono / monoSmall  URLs, hosts, counts, timestamps, codes
 */
import React from "react";
import {
  Text as RNText,
  type TextProps as RNTextProps,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { fontSize, lineHeight, resolveFont, type FontFamily } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

export type TextVariant =
  | "wordmark"
  | "display"
  | "title1"
  | "title2"
  | "title3"
  | "headline"
  | "header"
  | "body"
  | "bodyStrong"
  | "callout"
  | "subhead"
  | "footnote"
  | "caption"
  | "label"
  | "mono"
  | "monoSmall";

interface Preset {
  family: FontFamily;
  size: number;
  weight: TextStyle["fontWeight"];
  lineHeight: number;
  letterSpacing?: number;
  uppercase?: boolean;
}

const PRESETS: Record<TextVariant, Preset> = {
  wordmark: { family: "serif", size: fontSize["6xl"], weight: "700", lineHeight: lineHeight.tight },
  display: { family: "display", size: fontSize["4xl"], weight: "700", lineHeight: lineHeight.tight, letterSpacing: -0.5 },
  title1: { family: "display", size: fontSize["3xl"], weight: "700", lineHeight: lineHeight.snug, letterSpacing: -0.4 },
  title2: { family: "display", size: fontSize["2xl"], weight: "700", lineHeight: lineHeight.snug, letterSpacing: -0.3 },
  title3: { family: "display", size: fontSize.lg, weight: "600", lineHeight: lineHeight.snug, letterSpacing: -0.2 },
  headline: { family: "display", size: fontSize.xl, weight: "700", lineHeight: lineHeight.normal, letterSpacing: -0.3 },
  header: { family: "display", size: fontSize.lg, weight: "600", lineHeight: lineHeight.normal, letterSpacing: 1.4, uppercase: true },
  body: { family: "sans", size: fontSize.md, weight: "500", lineHeight: lineHeight.normal },
  bodyStrong: { family: "sans", size: fontSize.md, weight: "700", lineHeight: lineHeight.normal },
  callout: { family: "sans", size: fontSize.xl, weight: "400", lineHeight: lineHeight.normal },
  subhead: { family: "sans", size: fontSize.sm, weight: "600", lineHeight: lineHeight.normal },
  footnote: { family: "sans", size: fontSize.sm, weight: "500", lineHeight: lineHeight.normal },
  caption: { family: "display", size: fontSize.xs, weight: "500", lineHeight: lineHeight.normal, letterSpacing: 0.2 },
  label: { family: "display", size: fontSize.xs, weight: "600", lineHeight: lineHeight.normal, letterSpacing: 1.2, uppercase: true },
  mono: { family: "mono", size: fontSize.sm, weight: "400", lineHeight: lineHeight.normal },
  monoSmall: { family: "mono", size: fontSize.xs, weight: "400", lineHeight: lineHeight.normal },
};

/** Icon+label nav chrome. Same face as `caption`, tighter line for tab stacks. */
export const NAV_CHROME_TEXT = {
  fontFamily: resolveFont("display", "500"),
  fontSize: fontSize.xs,
  fontWeight: "500" as const,
  lineHeight: 14,
  letterSpacing: 0.2,
};

export type TextColor =
  | "primary"
  | "secondary"
  | "tertiary"
  | "faint"
  | "accent"
  | "onAccent"
  | "coral"
  | "green"
  | "blue"
  | "mustard"
  | "danger";

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  align?: "auto" | "left" | "center" | "right" | "justify";
}

export function Text({ variant = "body", color = "primary", align, style, ...rest }: TextProps) {
  const { palette } = useTheme();
  const preset = PRESETS[variant];

  const colorValue: string = {
    primary: palette.text,
    secondary: palette.textSecondary,
    tertiary: palette.textTertiary,
    faint: palette.textFaint,
    accent: palette.accent,
    onAccent: palette.onAccent,
    coral: palette.coral,
    green: palette.green,
    blue: palette.blue,
    mustard: palette.mustard,
    danger: palette.danger,
  }[color];

  const fontFamily = resolveFont(preset.family, preset.weight as string);

  const merged: StyleProp<TextStyle> = [
    {
      color: colorValue,
      fontFamily,
      fontSize: preset.size,
      fontWeight: preset.weight,
      lineHeight: Math.round(preset.size * preset.lineHeight),
      letterSpacing: preset.letterSpacing,
      textAlign: align,
      textTransform: preset.uppercase ? "uppercase" : undefined,
    },
    style,
  ];

  return <RNText style={merged} {...rest} />;
}
