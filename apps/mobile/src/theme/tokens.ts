/**
 * Design tokens — the single source of truth for spacing, radius, typography,
 * and motion. Material 3 roles are shared by native and web.
 */

/** Spacing scale (px). */
export const spacing = {
  0: 0,
  px: 1,
  2: 2,
  4: 4,
  6: 6,
  8: 8,
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  20: 20,
  24: 24,
  28: 28,
  32: 32,
  40: 40,
  48: 48,
  56: 56,
  64: 64,
  80: 80,
  96: 96,
} as const;

export type Spacing = keyof typeof spacing;

/**
 * Material 3 shape scale. Choose a component's role, not a universal radius.
 */
export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 28,
  "3xl": 32,
  "4xl": 48,
  full: 9999,
} as const;
export type Radius = keyof typeof radius;

/** Material typography sizes (sp / CSS px). */
export const fontSize = {
  "2xs": 11,
  xs: 12,
  sm: 12,
  md: 16,
  lg: 14,
  xl: 16,
  "2xl": 16,
  "3xl": 22,
  "4xl": 24,
  "5xl": 28,
  "6xl": 32,
} as const;
export type FontSize = keyof typeof fontSize;

/** Line heights relative to size. */
export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,
  loose: 1.8,
} as const;

/** Font weights. */
export const fontWeight = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

/* ----------------------------- Font families ----------------------------- */
// Loaded via @expo-google-fonts in app/_layout.tsx. Referenced by name string.

export type FontFamily = "display" | "sans" | "mono" | "serif";

const FONTS = {
  display: {
    "400": "Roboto_400Regular",
    "500": "Roboto_500Medium",
    "600": "Roboto_500Medium",
    "700": "Roboto_700Bold",
  },
  sans: {
    "400": "Roboto_400Regular",
    "500": "Roboto_500Medium",
    "600": "Roboto_500Medium",
    "700": "Roboto_700Bold",
  },
  mono: {
    "400": "JetBrainsMono_400Regular",
    "500": "JetBrainsMono_500Medium",
    "600": "JetBrainsMono_600SemiBold",
    "700": "JetBrainsMono_700Bold",
  },
  serif: {
    "400": "PlayfairDisplay_400Regular",
    "700": "PlayfairDisplay_700Bold",
    "400-italic": "PlayfairDisplay_400Regular_Italic",
  },
} as const;

/** Resolve a loaded font family + weight into a fontFamily string. */
export function resolveFont(
  family: FontFamily,
  weight: keyof typeof fontWeight | string = "400",
  italic?: boolean,
): string {
  if (family === "serif" && italic) return FONTS.serif["400-italic"];
  const table = FONTS[family] as Record<string, string>;
  return table[weight] ?? table["400"];
}

/** The list of font assets to preload (passed to useFonts in the root layout). */
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_400Regular_Italic,
} from "@expo-google-fonts/playfair-display";
import { ROW_INSET, SCREEN_RAIL } from "./alignment";
import { Roboto_400Regular, Roboto_500Medium, Roboto_700Bold } from "@expo-google-fonts/roboto";

export const fontAssets = {
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_400Regular_Italic,
};

/**
 * Layout constants.
 * Screen columns, the back chevron, and row icons share the rails in
 * `src/theme/alignment.ts`. Use those helpers instead of adding the safe
 * area on top of `screenHorizontalPad`.
 */
export const layout = {
  /** Page edge: list hairlines and header actions. */
  screenHorizontalPad: SCREEN_RAIL,
  /**
   * Leading and trailing inset inside a list row, measured from that row's
   * edge (the screen rail), not from the screen. Section labels use this
   * too, so they start on the icon well rather than the hairline.
   */
  rowInset: ROW_INSET,
  /**
   * Clearance under the status bar before the header row. The row is as
   * tall as a header control, so the back arrow clears the status bar
   * without a tall gap above a centered title.
   */
  headerTopGap: 8,
  /**
   * Space under the header row before the first screen element. Every
   * screen header shares this, so lists, search, and settings stay aligned.
   * Shrinking it pulls content up; it does not move the title.
   */
  headerContentGap: 16,
  touchTargetMin: 48,
  tabBarHeight: 60,
  maxContentWidth: 840,
  maxReaderWidth: 680,
  maxFormWidth: 480,
  maxSettingsWidth: 840,
  /** Trailing picker/value column in settings rows. */
  settingsControlWidth: 148,
  maxLibraryWidth: 1200,
  sheetWidth: 560,
  /** Inner padding for centered floating panels / dialogs. */
  overlayPadding: 24,
  /**
   * Inner padding for anchored context menus. 0 so hover fills the panel:
   * first row meets the top, last meets the bottom, left and right meet the
   * edge. Comfort is the row's inner padding, not chrome around the stack.
   */
  overlayMenuPadding: 0,
  overlayMaxWidth: 420,
  overlayConfirmWidth: 380,
  navigationRailWidth: 96,
} as const;

/**
 * Elevation shadows. ordo is mostly line-driven (no shadows on cards); shadows
 * are reserved for floating elements (FAB, sheets). Kept subtle.
 */
export interface Shadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export function makeShadow(color: string, level: 1 | 2 | 3): Shadow {
  const presets = {
    1: { offset: { width: 0, height: 1 }, opacity: 0.05, blur: 2, elevation: 1 },
    2: { offset: { width: 0, height: 2 }, opacity: 0.08, blur: 6, elevation: 3 },
    3: { offset: { width: 0, height: 6 }, opacity: 0.12, blur: 16, elevation: 6 },
  } as const;
  const p = presets[level];
  return {
    shadowColor: color,
    shadowOffset: p.offset,
    shadowOpacity: p.opacity,
    shadowRadius: p.blur,
    elevation: p.elevation,
  };
}

/** Motion: spring presets for Reanimated (physics-based, not durations). */
export const springs = {
  /** Fast, settled, no overshoot — default for UI feedback. */
  snappy: { damping: 67.35, stiffness: 1400, mass: 1 },
  /** Soft, natural motion — screen transitions, modals. */
  gentle: { damping: 47.62, stiffness: 700, mass: 1 },
  /** Playful bounce — confirmations, deletions. */
  bouncy: { damping: 31.19, stiffness: 380, mass: 1 },
} as const;

/** Timing presets (ms) for the rare non-spring animation (e.g. opacity fades). */
export const timing = {
  fast: 150,
  normal: 200,
  slow: 300,
} as const;
