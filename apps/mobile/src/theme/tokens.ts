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
// Loaded via @expo-google-fonts or assets/fonts in app/_layout.tsx. Referenced
// by name string. "book" (Libron) and "legible" (NV Legible Next) are the
// reader's reading typefaces; sans/mono drive app UI and code respectively.

export type FontFamily = "display" | "sans" | "mono" | "book" | "legible" | "garamond" | "bitter" | "jost";

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
  // Libron — a Newsreader reading variant with full italic support.
  book: {
    "400": "Libron_400Regular",
    "500": "Libron_700Bold",
    "600": "Libron_700Bold",
    "700": "Libron_700Bold",
    "400-italic": "Libron_400Regular_Italic",
    "700-italic": "Libron_700BoldItalic",
  },
  // NV Legible Next (Atkinson Hyperlegible Next) — built for legibility.
  legible: {
    "400": "NVLegibleNext_400Regular",
    "500": "NVLegibleNext_700Bold",
    "600": "NVLegibleNext_700Bold",
    "700": "NVLegibleNext_700Bold",
    "400-italic": "NVLegibleNext_400Regular_Italic",
    "700-italic": "NVLegibleNext_700BoldItalic",
  },
  // NV Garamond (EB Garamond) — classic old-style, "premium hardback" feel.
  garamond: {
    "400": "NVGaramond_400Regular",
    "500": "NVGaramond_400Regular",
    "600": "NVGaramond_700Bold",
    "700": "NVGaramond_700Bold",
    "400-italic": "NVGaramond_400Regular_Italic",
    "700-italic": "NVGaramond_700BoldItalic",
  },
  // NV Bitter — contemporary slab serif.
  bitter: {
    "400": "NVBitter_400Regular",
    "500": "NVBitter_700Bold",
    "600": "NVBitter_700Bold",
    "700": "NVBitter_700Bold",
    "400-italic": "NVBitter_400Regular_Italic",
    "700-italic": "NVBitter_700BoldItalic",
  },
  // NV Jost — Futura-like geometric sans.
  jost: {
    "400": "NVJost_400Regular",
    "500": "NVJost_700Bold",
    "600": "NVJost_700Bold",
    "700": "NVJost_700Bold",
    "400-italic": "NVJost_400Regular_Italic",
    "700-italic": "NVJost_700BoldItalic",
  },
} as const;

/** Resolve a loaded font family + weight into a fontFamily string. */
export function resolveFont(
  family: FontFamily,
  weight: keyof typeof fontWeight | string = "400",
  italic?: boolean,
): string {
  const table = FONTS[family] as Record<string, string>;
  if (italic) {
    const bold = weight === "600" || weight === "700";
    return (
      table[bold ? "700-italic" : "400-italic"] ??
      table[weight] ??
      table["400"]!
    );
  }
  return table[weight] ?? table["400"]!;
}

/** The list of font assets to preload (passed to useFonts in the root layout). */
// Import individual faces: the package barrels require every TTF and make
// Metro ship unused weights/styles, even though Font.loadAsync uses only these.
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono/600SemiBold";
import { JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono/700Bold";
import { ROW_INSET, SCREEN_RAIL } from "./alignment";
import { Roboto_400Regular } from "@expo-google-fonts/roboto/400Regular";
import { Roboto_500Medium } from "@expo-google-fonts/roboto/500Medium";
import { Roboto_700Bold } from "@expo-google-fonts/roboto/700Bold";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

// Reading typefaces ship as local TTFs (see assets/fonts/README.md).
import Libron_400Regular from "../../assets/fonts/Libron-Regular.ttf";
import Libron_400Regular_Italic from "../../assets/fonts/Libron-Italic.ttf";
import Libron_700Bold from "../../assets/fonts/Libron-Bold.ttf";
import Libron_700BoldItalic from "../../assets/fonts/Libron-BoldItalic.ttf";
import NVLegibleNext_400Regular from "../../assets/fonts/NVLegibleNext-Regular.ttf";
import NVLegibleNext_400Regular_Italic from "../../assets/fonts/NVLegibleNext-Italic.ttf";
import NVLegibleNext_700Bold from "../../assets/fonts/NVLegibleNext-Bold.ttf";
import NVLegibleNext_700BoldItalic from "../../assets/fonts/NVLegibleNext-BoldItalic.ttf";
import NVGaramond_400Regular from "../../assets/fonts/NVGaramond-Regular.ttf";
import NVGaramond_400Regular_Italic from "../../assets/fonts/NVGaramond-Italic.ttf";
import NVGaramond_700Bold from "../../assets/fonts/NVGaramond-Bold.ttf";
import NVGaramond_700BoldItalic from "../../assets/fonts/NVGaramond-BoldItalic.ttf";
import NVBitter_400Regular from "../../assets/fonts/NVBitter-Regular.ttf";
import NVBitter_400Regular_Italic from "../../assets/fonts/NVBitter-Italic.ttf";
import NVBitter_700Bold from "../../assets/fonts/NVBitter-Bold.ttf";
import NVBitter_700BoldItalic from "../../assets/fonts/NVBitter-BoldItalic.ttf";
import NVJost_400Regular from "../../assets/fonts/NVJost-Regular.ttf";
import NVJost_400Regular_Italic from "../../assets/fonts/NVJost-Italic.ttf";
import NVJost_700Bold from "../../assets/fonts/NVJost-Bold.ttf";
import NVJost_700BoldItalic from "../../assets/fonts/NVJost-BoldItalic.ttf";

export const fontAssets = {
  ...MaterialIcons.font,
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
  Libron_400Regular,
  Libron_400Regular_Italic,
  Libron_700Bold,
  Libron_700BoldItalic,
  NVLegibleNext_400Regular,
  NVLegibleNext_400Regular_Italic,
  NVLegibleNext_700Bold,
  NVLegibleNext_700BoldItalic,
  NVGaramond_400Regular,
  NVGaramond_400Regular_Italic,
  NVGaramond_700Bold,
  NVGaramond_700BoldItalic,
  NVBitter_400Regular,
  NVBitter_400Regular_Italic,
  NVBitter_700Bold,
  NVBitter_700BoldItalic,
  NVJost_400Regular,
  NVJost_400Regular_Italic,
  NVJost_700Bold,
  NVJost_700BoldItalic,
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
