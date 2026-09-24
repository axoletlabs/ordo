/**
 * Design tokens — the single source of truth for spacing, radius, typography,
 * and motion. Faithful to the ordo-archive design language: warm, compact,
 * line-driven. Every surface in the app derives from these.
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
 * Corner radius scale (px). ordo-archive uses small radii throughout:
 * cards/buttons/inputs at 8, dialogs/snackbars at 14, sheet tops at 16.
 */
export const radius = {
  none: 0,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  "2xl": 16,
  "3xl": 20,
  full: 9999,
} as const;
export type Radius = keyof typeof radius;

/** Typography sizes (px). Compact scale matching the original app. */
export const fontSize = {
  "2xs": 9,
  xs: 10.5,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 15,
  "2xl": 16,
  "3xl": 18,
  "4xl": 22,
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
    "400": "InterTight_400Regular",
    "500": "InterTight_500Medium",
    "600": "InterTight_600SemiBold",
    "700": "InterTight_700Bold",
  },
  sans: {
    "400": "Inter_400Regular",
    "500": "Inter_500Medium",
    "600": "Inter_600SemiBold",
    "700": "Inter_700Bold",
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
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  InterTight_700Bold,
} from "@expo-google-fonts/inter-tight";
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

export const fontAssets = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  InterTight_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_400Regular_Italic,
};

/** Layout constants. */
export const layout = {
  screenHorizontalPad: 16,
  /** Space under the header block before the first screen element. */
  headerContentGap: 8,
  touchTargetMin: 44,
  tabBarHeight: 60,
  maxContentWidth: 640,
  maxFormWidth: 480,
  maxSettingsWidth: 720,
  /** Trailing picker/value column in settings rows. */
  settingsControlWidth: 148,
  maxLibraryWidth: 1200,
  sheetWidth: 560,
  /** Inner padding for centered floating panels / dialogs. */
  overlayPadding: 16,
  /**
   * Inner padding for anchored context menus. 0 so hover fills the panel:
   * first row meets the top, last meets the bottom, left and right meet the
   * edge. Comfort is the row's inner padding, not chrome around the stack.
   */
  overlayMenuPadding: 0,
  overlayMaxWidth: 420,
  overlayConfirmWidth: 380,
  navigationRailWidth: 96,
  compactNavigationRailWidth: 80,
  compactNavigationRailHeight: 240,
  compactNavigationRailIconHeight: 176,
  compactFloatingDockWidth: 276,
  compactFloatingDockIconWidth: 176,
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
    3: { offset: { width: 0, height: 6 }, opacity: 0.12, blur: 16, elevation: 5 },
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
  snappy: { damping: 26, stiffness: 320, mass: 0.9 },
  /** Soft, natural motion — screen transitions, modals. */
  gentle: { damping: 22, stiffness: 160, mass: 1 },
  /** Playful bounce — confirmations, deletions. */
  bouncy: { damping: 13, stiffness: 180, mass: 0.9 },
} as const;

/** Timing presets (ms) for the rare non-spring animation (e.g. opacity fades). */
export const timing = {
  fast: 160,
  normal: 240,
  slow: 360,
} as const;
