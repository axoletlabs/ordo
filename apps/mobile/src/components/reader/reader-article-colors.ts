import type { TextStyle, ViewStyle } from "react-native";
import type { Palette } from "../../theme/theme";
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

export interface ReaderTagColors {
  /** Ink (+ inline surfaces) per tag, applied to selectable text and spans. */
  text: Record<string, TextStyle>;
  /** Block surface/border colors per tag, applied to block host views. */
  view: Record<string, ViewStyle>;
}

/** Ink and surface colors for article tags, applied at render time. The
 * render engine only bakes typography, so switching the reading theme (or the
 * system scheme flipping, or AMOLED) restyles the mounted tree instead of
 * rebuilding the engine and re-parsing every article section. Values must
 * stay in sync with the typography each tag resolves in the engine. */
export function readerTagColors(palette: Palette): ReaderTagColors {
  const colors = readerArticleColors(palette);
  const bodyInk = { color: colors.body };
  const headingInk = { color: palette.text };
  return {
    text: {
      body: bodyInk,
      p: bodyInk,
      li: bodyInk,
      blockquote: bodyInk,
      pre: bodyInk,
      h1: headingInk,
      h2: headingInk,
      h3: headingInk,
      h4: headingInk,
      h5: headingInk,
      h6: { color: palette.textTertiary },
      strong: headingInk,
      b: headingInk,
      a: { color: palette.accent },
      code: { color: palette.text, backgroundColor: colors.block },
      figcaption: { color: palette.textTertiary },
      th: headingInk,
      td: { color: palette.textSecondary },
      mark: { color: colors.onHighlight, backgroundColor: colors.highlight },
    },
    view: {
      blockquote: { borderLeftColor: palette.accent, backgroundColor: colors.block },
      pre: { backgroundColor: colors.block },
      hr: { borderBottomColor: palette.border },
      th: { borderColor: palette.border },
      td: { borderColor: palette.border },
    },
  };
}
