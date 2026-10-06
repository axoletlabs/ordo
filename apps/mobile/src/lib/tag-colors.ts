/**
 * Tag color resolution. Colors are stable semantic keys (see TAG_COLORS in
 * @ordo/shared); this module maps them to concrete values that read well on
 * both the warm light theme and the dark themes.
 */
import type { TagColor } from "@ordo/shared";

export interface TagColorValue {
  /** Solid swatch (picker dots, indicators). */
  dot: string;
  /** Chip text color for light surfaces. */
  fgLight: string;
  /** Chip text color for dark surfaces. */
  fgDark: string;
  /** Translucent chip fill; works on light and dark backgrounds. */
  fill: string;
}

export const TAG_COLOR_VALUES: Record<TagColor, TagColorValue> = {
  slate: { dot: "#64748B", fgLight: "#475569", fgDark: "#CBD5E1", fill: "rgba(100,116,139,0.16)" },
  red: { dot: "#DC2626", fgLight: "#B91C1C", fgDark: "#FCA5A5", fill: "rgba(220,38,38,0.16)" },
  orange: { dot: "#EA580C", fgLight: "#C2410C", fgDark: "#FDBA74", fill: "rgba(234,88,12,0.16)" },
  amber: { dot: "#D97706", fgLight: "#B45309", fgDark: "#FCD34D", fill: "rgba(217,119,6,0.18)" },
  green: { dot: "#16A34A", fgLight: "#15803D", fgDark: "#86EFAC", fill: "rgba(22,163,74,0.16)" },
  teal: { dot: "#0D9488", fgLight: "#0F766E", fgDark: "#5EEAD4", fill: "rgba(13,148,136,0.16)" },
  blue: { dot: "#2563EB", fgLight: "#1D4ED8", fgDark: "#93C5FD", fill: "rgba(37,99,235,0.16)" },
  indigo: { dot: "#4F46E5", fgLight: "#4338CA", fgDark: "#A5B4FC", fill: "rgba(79,70,229,0.16)" },
  violet: { dot: "#7C3AED", fgLight: "#6D28D9", fgDark: "#C4B5FD", fill: "rgba(124,58,237,0.16)" },
  pink: { dot: "#DB2777", fgLight: "#BE185D", fgDark: "#F9A8D4", fill: "rgba(219,39,119,0.16)" },
};

export function tagColorValue(color: TagColor): TagColorValue {
  return TAG_COLOR_VALUES[color] ?? TAG_COLOR_VALUES.blue;
}

