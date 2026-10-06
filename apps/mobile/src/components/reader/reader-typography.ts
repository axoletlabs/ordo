import { resolveFont, type FontFamily } from "../../theme/tokens";
import type { ReaderFontFamily, ReaderFontSize, ReaderLineSpacing } from "@ordo/shared";

/** Reader families map onto dedicated reading typefaces (see assets/fonts). */
const FAMILY: Record<ReaderFontFamily, FontFamily> = {
  sans: "legible",
  serif: "book",
  garamond: "garamond",
  bitter: "bitter",
  jost: "jost",
};

export const READER_BODY_SIZE: Record<ReaderFontSize, number> = {
  small: 15,
  medium: 17,
  large: 19,
  xlarge: 21,
};

/** Body line-height multipliers applied to the chosen body size. */
export const READER_LINE_SPACING: Record<ReaderLineSpacing, number> = {
  compact: 1.45,
  default: 1.65,
  relaxed: 1.85,
};

export function resolveReaderFontFamily(family: ReaderFontFamily): FontFamily {
  return FAMILY[family];
}

export function resolveReaderFont(family: ReaderFontFamily, weight = "400"): string {
  return resolveFont(resolveReaderFontFamily(family), weight);
}

/** Body line height in px for a size + spacing preference. */
export function readerLineHeight(size: number, spacing: ReaderLineSpacing): number {
  return Math.round(size * READER_LINE_SPACING[spacing]);
}
