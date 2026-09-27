import { fontSize, lineHeight } from "./tokens";

/**
 * Footnote line box (12 × 1.5). A checkbox or list mark beside wrapping
 * footnote copy uses this height and stays on the first line.
 */
export const FOOTNOTE_LINE_BOX = Math.round(fontSize.sm * lineHeight.normal);

/** Square drawn inside {@link FOOTNOTE_LINE_BOX}. Its ink is centered in the box. */
export const CHECK_GLYPH = 16;
