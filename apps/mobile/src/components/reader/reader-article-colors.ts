import type { MaterialColors } from "../../theme/material-colors";
import type { RenderHTMLProps } from "@native-html/render";

/** One role pairing for native article text, spans, code, tables and marks. */
export function readerArticleColors(palette: MaterialColors) {
  return {
    body: palette.onSurface,
    supporting: palette.onSurfaceVariant,
    link: palette.primary,
    block: palette.surfaceContainerLow,
    divider: palette.outlineVariant,
    highlight: palette.tertiaryContainer,
    onHighlight: palette.onTertiaryContainer,
    // Native selection keeps each span's ink. A tonal surface remains readable
    // even at high contrast, where primaryContainer may flip to a dark fill.
    selection: palette.surfaceContainerHighest,
  };
}

// Keep source-site styling from overriding reader preferences or contrast.
export const READER_IGNORED_INLINE_STYLES: NonNullable<RenderHTMLProps["ignoredStyles"]> = ["color", "backgroundColor", "fontFamily", "fontSize", "lineHeight"];
