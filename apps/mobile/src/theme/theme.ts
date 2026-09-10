/**
 * Color palettes faithful to ordo-archive: a warm Gruvbox/parchment system.
 * Light = cream surfaces with warm near-black ink; Dark = warm dark surfaces
 * with cream ink; AMOLED = pure black with neutral grays. Coral is the single
 * primary accent (also used for danger/error, matching the original).
 */
import { makeShadow, type Shadow } from "./tokens";

export type ThemeMode = "light" | "dark" | "system";

export interface Palette {
  mode: "light" | "dark";
  amoled: boolean;

  background: string;
  surface: string;
  surfaceSecondary: string;
  surfaceElevated: string;

  /** Primary ink (headings). */
  text: string;
  /** inkSoft — body text. */
  textSecondary: string;
  /** inkMute — captions, meta. */
  textTertiary: string;
  /** inkFaint — placeholders, faint meta. */
  textFaint: string;

  /** Thin separator (line). */
  border: string;
  /** Stronger separator (lineThick). */
  borderStrong: string;

  /** Coral — primary accent. */
  accent: string;
  onAccent: string;
  accentSoft: string;

  // Semantic accents (shared across modes, used for chips/tints).
  coral: string;
  green: string;
  blue: string;
  mustard: string;

  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;

  /** Dim scrim behind modals/sheets. */
  overlay: string;
}

const light: Palette = {
  mode: "light",
  amoled: false,
  background: "#EFE7D2",
  surface: "#F7F1DE",
  surfaceSecondary: "#E7DEC6",
  surfaceElevated: "#FBF6E6",
  text: "#15140F",
  textSecondary: "#2A2620",
  textTertiary: "#5A5448",
  textFaint: "#8B8676",
  border: "rgba(21,20,15,0.10)",
  borderStrong: "rgba(21,20,15,0.18)",
  accent: "#ED6F5C",
  onAccent: "#FFFFFF",
  accentSoft: "rgba(237,111,92,0.12)",
  coral: "#ED6F5C",
  green: "#6C8F3A",
  blue: "#4F7DA6",
  mustard: "#D9A83A",
  success: "#6C8F3A",
  warning: "#D9A83A",
  danger: "#ED6F5C",
  dangerSoft: "rgba(237,111,92,0.12)",
  overlay: "rgba(0,0,0,0.5)",
};

const dark: Palette = {
  mode: "dark",
  amoled: false,
  background: "#1A1A16",
  surface: "#22221D",
  surfaceSecondary: "#2A2A24",
  surfaceElevated: "#28281F",
  text: "#EBDDB2",
  textSecondary: "#D5C4A1",
  textTertiary: "#928374",
  textFaint: "#6C6457",
  border: "rgba(235,221,178,0.08)",
  borderStrong: "rgba(235,221,178,0.14)",
  accent: "#ED6F5C",
  onAccent: "#FFFFFF",
  accentSoft: "rgba(237,111,92,0.16)",
  coral: "#ED6F5C",
  green: "#8AAA5A",
  blue: "#7DAEA3",
  mustard: "#D9A83A",
  success: "#8AAA5A",
  warning: "#D9A83A",
  danger: "#ED6F5C",
  dangerSoft: "rgba(237,111,92,0.16)",
  overlay: "rgba(0,0,0,0.5)",
};

/** AMOLED: pure-black surfaces + neutral grays (dark + AMOLED toggle). */
const amoledOverrides: Partial<Palette> = {
  amoled: true,
  background: "#000000",
  surface: "#0A0A0A",
  surfaceSecondary: "#141414",
  surfaceElevated: "#101010",
  text: "#E0E0E0",
  textSecondary: "#B0B0B0",
  textTertiary: "#707070",
  textFaint: "#454545",
  border: "rgba(224,224,224,0.08)",
  borderStrong: "rgba(224,224,224,0.14)",
  overlay: "rgba(0,0,0,0.6)",
};

/** Resolve the effective palette from a mode (+ system hint) and amoled flag. */
export function resolvePalette(
  mode: ThemeMode,
  amoled: boolean,
  systemColorScheme: "light" | "dark" | null | undefined,
): Palette {
  const resolvedMode: "light" | "dark" =
    mode === "system" ? (systemColorScheme === "dark" ? "dark" : "light") : mode;
  const base = resolvedMode === "dark" ? dark : light;
  if (resolvedMode === "dark" && amoled) {
    return { ...base, ...amoledOverrides };
  }
  return base;
}

export interface Shadows {
  level1: Shadow;
  level2: Shadow;
  level3: Shadow;
}

export function resolveShadows(p: Palette): Shadows {
  const c = p.mode === "dark" ? "#000000" : "#15140F";
  return {
    level1: makeShadow(c, 1),
    level2: makeShadow(c, 2),
    level3: makeShadow(c, 3),
  };
}
