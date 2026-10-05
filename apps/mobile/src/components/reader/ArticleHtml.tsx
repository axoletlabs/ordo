/**
 * Sanitized semantic article HTML rendered with native views via
 * @native-html/render — no WebView, no JavaScript.
 *
 * The server pipeline (Readability → sanitize-html) emits an allowlisted
 * semantic subset (p/headings/lists/blockquote/pre/code/figure/table/links,
 * http(s)/mailto schemes only, no scripts/iframes), so this component's job
 * is purely presentation: token-driven typography scaled by the reader
 * preferences, responsive images, select-to-highlight text, and external links.
 */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Linking,
  StyleSheet,
  Text,
  View,
  type View as ViewType,
} from "react-native";
import RenderHTML, {
  defaultSystemFonts,
  useRendererProps,
  type CustomBlockRenderer,
  type MixedStyleRecord,
  type RenderHTMLProps,
  type RenderersProps,
  type TNode,
  type TDocument,
} from "@native-html/render";
import { useTheme } from "../../theme/ThemeProvider";
import type { Palette } from "../../theme/theme";
import { radius, resolveFont, spacing, type FontFamily } from "../../theme/tokens";
import type { HighlightDto, ReaderLineSpacing, ReaderPreferences } from "@ordo/shared";
import { applyHighlightsToHtml, htmlToPlainText } from "@ordo/shared";
import { readerArticleColors, READER_IGNORED_INLINE_STYLES } from "./reader-article-colors";
import {
  READER_BODY_SIZE,
  readerLineHeight,
  resolveReaderFontFamily,
} from "./reader-typography";
import {
  collectTableRows,
  plainTextFromNode,
  splitTableHeader,
  tnodeContainsMedia,
} from "./article-html-table";
import {
  HighlightUiContext,
  SelectablePhrase,
  asHtmlNode,
  anchorRenderer,
  ignoreTextSelect,
  markRenderer,
  selectableBlockRenderer,
  type HighlightUiHandlers,
} from "./article-highlight-ui";

/** Custom fonts loaded via useFonts must be registered to avoid warnings. */
const SYSTEM_FONTS = [
  ...defaultSystemFonts,
  "Roboto_400Regular",
  "Roboto_500Medium",
  "Roboto_700Bold",
  "JetBrainsMono_400Regular",
  "JetBrainsMono_500Medium",
  "JetBrainsMono_600SemiBold",
  "JetBrainsMono_700Bold",
  "Libron_400Regular",
  "Libron_400Regular_Italic",
  "Libron_700Bold",
  "Libron_700BoldItalic",
  "NVLegibleNext_400Regular",
  "NVLegibleNext_400Regular_Italic",
  "NVLegibleNext_700Bold",
  "NVLegibleNext_700BoldItalic",
];

/** Only http(s)/mailto may leave the app; everything else is ignored. */
export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href) || /^mailto:/i.test(href);
}

function heading(size: number) {
  return { fontSize: size, lineHeight: Math.round(size * 1.3) };
}

function buildTagsStyles(
  palette: Palette,
  family: FontFamily,
  base: number,
  lineSpacing: ReaderLineSpacing,
): MixedStyleRecord {
  const colors = readerArticleColors(palette);
  const bodyFont = (weight = "400") => resolveFont(family, weight);
  const monoSize = Math.max(12, base - 2);
  const bodyLineHeight = readerLineHeight(base, lineSpacing);
  const cell = {
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[10],
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
  };

  const body = {
    fontFamily: bodyFont(),
    fontSize: base,
    lineHeight: bodyLineHeight,
    color: colors.body,
  };

  return {
    body,
    p: {
      ...body,
      marginTop: spacing[14],
      textAlign: "left",
    },
    h1: {
      fontFamily: bodyFont("700"),
      color: palette.text,
      marginTop: spacing[28],
      marginBottom: spacing[6],
      ...heading(base * 1.65),
    },
    h2: {
      fontFamily: bodyFont("700"),
      color: palette.text,
      marginTop: spacing[24],
      marginBottom: spacing[6],
      ...heading(base * 1.45),
    },
    h3: {
      fontFamily: bodyFont("600"),
      color: palette.text,
      marginTop: spacing[20],
      marginBottom: spacing[4],
      ...heading(base * 1.28),
    },
    h4: {
      fontFamily: bodyFont("600"),
      color: palette.text,
      marginTop: spacing[20],
      marginBottom: spacing[4],
      ...heading(base * 1.12),
    },
    h5: { ...heading(base), fontFamily: bodyFont("600"), color: palette.text, marginTop: spacing[16], marginBottom: spacing[4] },
    h6: { ...heading(base * 0.95), fontFamily: bodyFont("600"), color: palette.textTertiary, marginTop: spacing[16], marginBottom: spacing[4] },
    strong: { fontFamily: bodyFont("700"), color: palette.text },
    b: { fontFamily: bodyFont("700"), color: palette.text },
    em: {
      fontFamily: resolveFont(family, "400", true),
      fontStyle: "italic",
    },
    i: {
      fontFamily: resolveFont(family, "400", true),
      fontStyle: "italic",
    },
    a: { color: palette.accent, textDecorationLine: "underline" },
    ul: { marginTop: spacing[12], marginBottom: spacing[8] },
    ol: { marginTop: spacing[12], marginBottom: spacing[8] },
    li: {
      fontFamily: bodyFont(),
      fontSize: base,
      lineHeight: Math.round(bodyLineHeight * 0.97),
      color: colors.body,
      marginBottom: spacing[6],
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: palette.accent,
      backgroundColor: colors.block,
      paddingHorizontal: spacing[16],
      paddingVertical: spacing[12],
      borderRadius: radius.sm,
      marginTop: spacing[16],
    },
    pre: {
      fontFamily: resolveFont("mono", "400"),
      fontSize: monoSize,
      lineHeight: Math.round(monoSize * 1.55),
      color: colors.body,
      backgroundColor: colors.block,
      paddingHorizontal: spacing[16],
      paddingVertical: spacing[12],
      borderRadius: radius.sm,
      marginTop: spacing[16],
    },
    code: {
      fontFamily: resolveFont("mono", "400"),
      fontSize: monoSize,
      color: palette.text,
      backgroundColor: colors.block,
    },
    figure: { marginTop: spacing[20], alignItems: "center" },
    figcaption: {
      fontFamily: bodyFont(),
      fontSize: Math.max(11, base - 3),
      lineHeight: Math.round(Math.max(11, base - 3) * 1.45),
      color: palette.textTertiary,
      textAlign: "center",
      marginTop: spacing[6],
    },
    img: { borderRadius: radius.sm },
    picture: { marginTop: spacing[16] },
    table: { marginTop: spacing[16] },
    th: {
      ...cell,
      fontFamily: bodyFont("600"),
      fontSize: monoSize,
      color: palette.text,
    },
    td: {
      ...cell,
      fontFamily: bodyFont(),
      fontSize: monoSize,
      color: palette.textSecondary,
    },
    hr: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      marginVertical: spacing[20],
    },
    mark: {
      backgroundColor: colors.highlight,
      color: colors.onHighlight,
    },
    small: { fontSize: Math.max(11, base - 3) },
  };
}

export interface ArticleHtmlProps {
  html: string;
  preferences: ReaderPreferences;
  /** Measured width available to the article; drives responsive images. */
  contentWidth: number;
  highlights?: readonly HighlightDto[];
  onTextSelect?: HighlightUiHandlers["onTextSelect"];
  onHeadingsChange?: (headings: readonly ArticleHeading[]) => void;
  onHeadingRef?: (id: string, view: ViewType | null) => void;
  /** Fires once the native HTML tree is actually mounted (after first paint). */
  onReady?: () => void;
}

export interface ArticleHeading {
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

interface HeadingRendererProps {
  onHeadingRef?: ArticleHtmlProps["onHeadingRef"];
}

const headingRenderer: CustomBlockRenderer = ({
  tnode,
  TDefaultRenderer,
  TNodeChildrenRenderer,
  ...props
}) => {
  const { onHeadingRef } = useRendererProps(tnode.tagName as "h1") as HeadingRendererProps;
  const setRef = useCallback(
    (view: ViewType | null) => {
      if (tnode.id) onHeadingRef?.(tnode.id, view);
    },
    [onHeadingRef, tnode.id],
  );

  if (tnodeContainsMedia(asHtmlNode(tnode))) {
    return (
      <View ref={setRef} collapsable={false}>
        <TDefaultRenderer tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} {...props} />
      </View>
    );
  }

  return (
    <View ref={setRef} collapsable={false}>
      <TDefaultRenderer tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} {...props}>
        <SelectablePhrase tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} />
      </TDefaultRenderer>
    </View>
  );
};

interface TableRendererProps {
  base: number;
  family: FontFamily;
}

/**
 * GitHub-style markdown tables (and other wide grids) are Yoga-flex cells
 * in render-html's default UA stylesheet. A dozen of those on first paint
 * stalls navigation for a second or more. Stack each row as labeled fields
 * instead so the article chrome can show immediately.
 */
const tableRenderer: CustomBlockRenderer = ({ tnode, TNodeChildrenRenderer }) => {
  const { palette } = useTheme();
  const tableProps = useRendererProps<
    RenderersProps & { table: TableRendererProps },
    "table"
  >("table");
  const base = tableProps?.base ?? READER_BODY_SIZE.medium;
  const family = tableProps?.family ?? "sans";
  const { header, body } = splitTableHeader(collectTableRows(tnode));
  const labels = header?.map(plainTextFromNode) ?? [];
  const labelSize = Math.max(11, base - 3);

  if (body.length === 0 && !header) return null;

  const records = body.length > 0 ? body : header ? [header] : [];
  const showLabels = labels.some(Boolean) && body.length > 0;

  return (
    <View
      style={[
        styles.table,
        { borderColor: palette.outlineVariant, backgroundColor: palette.surfaceContainerLow },
      ]}
    >
      {records.map((row, rowIndex) => (
        <View
          key={rowIndex}
          style={[
            styles.tableRecord,
            rowIndex > 0 ? { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
          ]}
        >
          {row.map((cell, cellIndex) => (
            <View key={cellIndex}>
              {showLabels && labels[cellIndex] ? (
                <Text
                  style={{
                    fontFamily: resolveFont(family, "600"),
                    fontSize: labelSize,
                    lineHeight: Math.round(labelSize * 1.35),
                    color: palette.textTertiary,
                    marginBottom: spacing[2],
                  }}
                >
                  {labels[cellIndex]}
                </Text>
              ) : null}
              <SelectablePhrase tnode={cell as TNode} TNodeChildrenRenderer={TNodeChildrenRenderer} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
};

const ARTICLE_RENDERERS = {
  h1: headingRenderer,
  h2: headingRenderer,
  h3: headingRenderer,
  h4: selectableBlockRenderer,
  h5: selectableBlockRenderer,
  h6: selectableBlockRenderer,
  p: selectableBlockRenderer,
  li: selectableBlockRenderer,
  blockquote: selectableBlockRenderer,
  figcaption: selectableBlockRenderer,
  pre: selectableBlockRenderer,
  table: tableRenderer,
  a: anchorRenderer,
  mark: markRenderer,
};

function textFromNode(node: TNode): string {
  if (node.type === "text") return node.data;
  return node.children.map(textFromNode).join("");
}

function headingsFromTree(tree: TDocument): ArticleHeading[] {
  const headings: ArticleHeading[] = [];
  const visit = (node: TNode) => {
    if (node.type !== "text" && /^h[1-3]$/.test(node.tagName ?? "") && node.id) {
      const text = textFromNode(node).replace(/\s+/g, " ").trim();
      if (text) {
        headings.push({
          id: node.id,
          level: Number(node.tagName?.slice(1)) as ArticleHeading["level"],
          text,
        });
      }
    }
    if (node.type !== "text") node.children.forEach(visit);
  };
  visit(tree);
  return headings;
}

const EMPTY_HIGHLIGHTS: HighlightDto[] = [];

export const ArticleHtml = React.memo(function ArticleHtml({
  html,
  preferences,
  contentWidth,
  highlights,
  onTextSelect,
  onHeadingsChange,
  onHeadingRef,
  onReady,
}: ArticleHtmlProps) {
  const { palette } = useTheme();
  const colors = readerArticleColors(palette);
  const family = resolveReaderFontFamily(preferences.fontFamily);
  const base = READER_BODY_SIZE[preferences.fontSize];
  const lineSpacing: ReaderLineSpacing = preferences.lineSpacing ?? "default";
  const highlightedHtml = useMemo(
    () => applyHighlightsToHtml(html, highlights ?? EMPTY_HIGHLIGHTS),
    [html, highlights],
  );
  const source = useMemo(() => ({ html: highlightedHtml }), [highlightedHtml]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [html, onReady]);

  const tagsStyles = useMemo(
    () => buildTagsStyles(palette, family, base, lineSpacing),
    [palette, family, base, lineSpacing],
  );
  // Pin untagged text to the reader, not the app/activity appearance.
  const baseStyle = useMemo(
    () => ({
      color: palette.onSurface,
      fontFamily: resolveFont(family),
      fontSize: base,
      lineHeight: readerLineHeight(base, lineSpacing),
    }),
    [palette.onSurface, family, base, lineSpacing],
  );
  const defaultTextProps = useMemo(
    () => ({
      selectable: false as const,
      selectionColor: colors.selection,
      style: { color: palette.onSurface },
    }),
    [colors.selection, palette.onSurface],
  );
  const onTextSelectRef = useRef(onTextSelect);
  onTextSelectRef.current = onTextSelect;
  // Parsing the article is independent of colors/font size. Keep it warm when
  // controls change rather than rescanning a long document on every reflow.
  const articlePlain = useMemo(() => htmlToPlainText(html), [html]);
  const highlightUi = useMemo(
    () => ({
      articlePlain,
      selectionColor: colors.selection,
      highlightStyle: { color: colors.onHighlight, backgroundColor: colors.highlight },
      textStyle: baseStyle,
      onTextSelect: (draft) => (onTextSelectRef.current ?? ignoreTextSelect)(draft),
    }) satisfies HighlightUiHandlers,
    [baseStyle, articlePlain, colors.highlight, colors.onHighlight, colors.selection],
  );

  // List markers should match the article's font (and accent color).
  const markerTextStyle = useMemo(
    () => ({
      color: palette.accent,
      fontFamily: resolveFont(family, "400"),
      fontSize: base,
    }),
    [palette, family, base],
  );
  const renderersProps = useMemo(
    () =>
      ({
        a: {
          onPress: (_event: unknown, href: string) => {
            if (isExternalHref(href)) Linking.openURL(href).catch(() => {});
          },
        },
        ul: { markerTextStyle },
        ol: { markerTextStyle },
        h1: { onHeadingRef },
        h2: { onHeadingRef },
        h3: { onHeadingRef },
        table: { base, family },
      }) as Partial<RenderersProps>,
    [markerTextStyle, onHeadingRef, base, family],
  );
  const domVisitors = useMemo<NonNullable<RenderHTMLProps["domVisitors"]>>(() => {
    let headingIndex = 0;
    return {
      onDocument: () => {
        headingIndex = 0;
      },
      onElement: (element) => {
        if (/^h[1-3]$/.test(element.name) && !element.attribs.id) {
          element.attribs.id = `ordo-heading-${headingIndex}`;
          headingIndex += 1;
        }
      },
    };
  }, []);
  const handleTreeChange = useCallback(
    (tree: TDocument) => onHeadingsChange?.(headingsFromTree(tree)),
    [onHeadingsChange],
  );

  if (contentWidth <= 0) return null;

  return (
    <HighlightUiContext.Provider value={highlightUi}>
    <RenderHTML
      source={source}
      contentWidth={contentWidth}
      baseStyle={baseStyle}
      tagsStyles={tagsStyles}
      renderersProps={renderersProps}
      renderers={ARTICLE_RENDERERS}
      domVisitors={domVisitors}
      onTTreeChange={handleTreeChange}
      systemFonts={SYSTEM_FONTS}
      defaultTextProps={defaultTextProps}
      ignoredStyles={READER_IGNORED_INLINE_STYLES}
    />
    </HighlightUiContext.Provider>
  );
});

const styles = StyleSheet.create({
  table: {
    marginTop: spacing[16],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  tableRecord: {
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[10],
    gap: spacing[8],
  },
});
