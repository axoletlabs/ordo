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
import React, { startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  StyleSheet,
  Text,
  View,
  type View as ViewType,
} from "react-native";
import {
  RenderHTMLSource,
  RenderHTMLConfigProvider,
  TRenderEngineProvider,
  defaultSystemFonts,
  useRendererProps,
  type CustomBlockRenderer,
  type MixedStyleRecord,
  type RenderersProps,
  type TNode,
} from "@native-html/render";
import { ARTICLE_END_CLASS, prepareArticleSections, reuseArticleSections } from "./article-sections";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, resolveFont, spacing, type FontFamily } from "../../theme/tokens";
import type { HighlightDto, ReaderLineSpacing } from "@ordo/shared";
import { applyHighlightsToHtml, htmlToPlainText } from "@ordo/shared";
import { readerArticleColors, readerTagColors, READER_IGNORED_INLINE_STYLES } from "./reader-article-colors";
import { useAnimationActivityEffect } from "../../hooks/use-animation-activity";
import { scheduleIdleWork } from "../../lib/idle-work";
import type { ReaderWorkScheduler } from "./reader-work";
import {
  READER_BODY_SIZE,
  readerLineHeight,
  resolveReaderFontFamily,
  type ReaderContentPreferences,
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
  codeRenderer,
  ignoreTextSelect,
  imageRenderer,
  markRenderer,
  ruleRenderer,
  selectableBlockRenderer,
  strongRenderer,
  type HighlightUiHandlers,
} from "./article-highlight-ui";

/** Custom fonts loaded by theme/fonts.ts must be registered to avoid warnings. */
const SYSTEM_FONTS = [
  ...defaultSystemFonts,
  "Roboto_400Regular",
  "Roboto_500Medium",
  "Roboto_700Bold",
  "JetBrainsMono_400Regular",
  "JetBrainsMono_600SemiBold",
  "Libron_400Regular",
  "Libron_400Regular_Italic",
  "Libron_700Bold",
  "Libron_700BoldItalic",
  "NVLegibleNext_400Regular",
  "NVLegibleNext_400Regular_Italic",
  "NVLegibleNext_700Bold",
  "NVLegibleNext_700BoldItalic",
  "NVGaramond_400Regular",
  "NVGaramond_400Regular_Italic",
  "NVGaramond_700Bold",
  "NVGaramond_700BoldItalic",
  "NVBitter_400Regular",
  "NVBitter_400Regular_Italic",
  "NVBitter_700Bold",
  "NVBitter_700BoldItalic",
  "NVJost_400Regular",
  "NVJost_400Regular_Italic",
  "NVJost_700Bold",
  "NVJost_700BoldItalic",
];

/** Only http(s)/mailto may leave the app; everything else is ignored. */
export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href) || /^mailto:/i.test(href);
}

function heading(size: number) {
  return { fontSize: size, lineHeight: Math.round(size * 1.3) };
}

/** Typography and structure only: everything in here is baked into the
 * render engine's resolved tree. Ink and surface colors are deliberately
 * excluded (see readerTagColors) so a palette change restyles the mounted
 * tree at render time instead of rebuilding the engine and re-parsing every
 * article section. */
function buildTagsStyles(
  family: FontFamily,
  base: number,
  lineSpacing: ReaderLineSpacing,
): MixedStyleRecord {
  const bodyFont = (weight = "400") => resolveFont(family, weight);
  const monoSize = Math.max(12, base - 2);
  const bodyLineHeight = readerLineHeight(base, lineSpacing);
  const cell = {
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[10],
    borderWidth: StyleSheet.hairlineWidth,
  };

  const body = {
    fontFamily: bodyFont(),
    fontSize: base,
    lineHeight: bodyLineHeight,
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
      marginTop: spacing[28],
      marginBottom: spacing[6],
      ...heading(base * 1.65),
    },
    h2: {
      fontFamily: bodyFont("700"),
      marginTop: spacing[24],
      marginBottom: spacing[6],
      ...heading(base * 1.45),
    },
    h3: {
      fontFamily: bodyFont("600"),
      marginTop: spacing[20],
      marginBottom: spacing[4],
      ...heading(base * 1.28),
    },
    h4: {
      fontFamily: bodyFont("600"),
      marginTop: spacing[20],
      marginBottom: spacing[4],
      ...heading(base * 1.12),
    },
    h5: { ...heading(base), fontFamily: bodyFont("600"), marginTop: spacing[16], marginBottom: spacing[4] },
    h6: { ...heading(base * 0.95), fontFamily: bodyFont("600"), marginTop: spacing[16], marginBottom: spacing[4] },
    strong: { fontFamily: bodyFont("700") },
    b: { fontFamily: bodyFont("700") },
    em: {
      fontFamily: resolveFont(family, "400", true),
      fontStyle: "italic",
    },
    i: {
      fontFamily: resolveFont(family, "400", true),
      fontStyle: "italic",
    },
    a: { textDecorationLine: "underline" },
    ul: { marginTop: spacing[12], marginBottom: spacing[8] },
    ol: { marginTop: spacing[12], marginBottom: spacing[8] },
    li: {
      fontFamily: bodyFont(),
      fontSize: base,
      lineHeight: Math.round(bodyLineHeight * 0.97),
      marginBottom: spacing[6],
    },
    blockquote: {
      borderLeftWidth: 3,
      paddingHorizontal: spacing[16],
      paddingVertical: spacing[12],
      borderRadius: radius.sm,
      marginTop: spacing[16],
    },
    pre: {
      fontFamily: resolveFont("mono", "400"),
      fontSize: monoSize,
      lineHeight: Math.round(monoSize * 1.55),
      paddingHorizontal: spacing[16],
      paddingVertical: spacing[12],
      borderRadius: radius.sm,
      marginTop: spacing[16],
    },
    code: {
      fontFamily: resolveFont("mono", "400"),
      fontSize: monoSize,
    },
    figure: { marginTop: spacing[20], alignItems: "center" },
    figcaption: {
      fontFamily: bodyFont(),
      fontSize: Math.max(11, base - 3),
      lineHeight: Math.round(Math.max(11, base - 3) * 1.45),
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
    },
    td: {
      ...cell,
      fontFamily: bodyFont(),
      fontSize: monoSize,
    },
    hr: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      marginVertical: spacing[20],
    },
    small: { fontSize: Math.max(11, base - 3) },
  };
}

export interface ArticleHtmlProps {
  html: string;
  /** Layout-affecting preferences only; palette/ink arrives through context. */
  preferences: ReaderContentPreferences;
  /** Measured width available to the article; drives responsive images. */
  contentWidth: number;
  highlights?: readonly HighlightDto[];
  onTextSelect?: HighlightUiHandlers["onTextSelect"];
  onHeadingsChange?: (headings: readonly ArticleHeading[]) => void;
  onHeadingRef?: (id: string, view: ViewType | null) => void;
  /** Fires once the native HTML tree is actually mounted (after first paint). */
  onReady?: () => void;
  workScheduler?: ReaderWorkScheduler;
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
  const ui = useContext(HighlightUiContext);
  const setRef = useCallback(
    (view: ViewType | null) => {
      if (tnode.id) onHeadingRef?.(tnode.id, view);
    },
    [onHeadingRef, tnode.id],
  );

  if (tnodeContainsMedia(asHtmlNode(tnode))) {
    return (
      <View ref={setRef} collapsable={false}>
        <TDefaultRenderer tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} {...props} textProps={{ style: ui?.tagTextColors?.[tnode.tagName ?? ""] }} />
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
  hr: ruleRenderer,
  img: imageRenderer,
  code: codeRenderer,
  strong: strongRenderer,
  b: strongRenderer,
};

const EMPTY_HIGHLIGHTS: HighlightDto[] = [];
const ARTICLE_CLASSES_STYLES = { [ARTICLE_END_CLASS]: { marginBottom: 0 } };

/** Keep the scheduler below the providers: appending a section must not update
 * engine/config contexts or walk every already-mounted article component. */
function ArticleSections({ sections, contentWidth, onReady, workScheduler }: {
  sections: ReturnType<typeof prepareArticleSections>["sections"];
  contentWidth: number;
  onReady?: () => void;
  workScheduler?: ReaderWorkScheduler;
}) {
  const [mountedCount, setMountedCount] = useState(1);
  const count = Math.min(mountedCount, Math.max(1, sections.length));
  const prepareNextSection = useCallback((active: boolean) => {
    if (!active || count >= sections.length) return;
    // Keep each native commit small, allow input to interrupt React's render,
    // and stop preparing background content while Contents/another overlay owns it.
    return (workScheduler?.schedule ?? scheduleIdleWork)(() => startTransition(() => setMountedCount(count + 1)));
  }, [count, sections, workScheduler]);
  useAnimationActivityEffect(prepareNextSection);
  useEffect(() => {
    if (count < sections.length) return;
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [count, sections, onReady]);
  // A background-activity change cancels work, not already-mounted HTML trees.
  return useMemo(() => <>{sections.slice(0, count).map((source, index) => (
    <RenderHTMLSource key={index} source={source} contentWidth={contentWidth} />
  ))}</>, [sections, count, contentWidth]);
}

export const ArticleHtml = React.memo(function ArticleHtml({
  html,
  preferences,
  contentWidth,
  highlights,
  onTextSelect,
  onHeadingsChange,
  onHeadingRef,
  onReady,
  workScheduler,
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
  const previousSections = useRef<ReturnType<typeof prepareArticleSections>["sections"]>([]);
  const { sections, headings } = useMemo(() => {
    const prepared = prepareArticleSections(highlightedHtml);
    prepared.sections = reuseArticleSections(previousSections.current, prepared.sections);
    previousSections.current = prepared.sections;
    return prepared;
  }, [highlightedHtml]);
  // Keep already mounted sections stable. Appending bounded batches yields
  // to input/navigation instead of mounting thousands of native text views in
  // one uninterruptible commit. All sections remain mounted, preserving OS text
  // selection, exact heading refs and the existing ScrollView position model.
  useEffect(() => { onHeadingsChange?.(headings); }, [headings, onHeadingsChange]);

  const tagsStyles = useMemo(
    () => buildTagsStyles(family, base, lineSpacing),
    [family, base, lineSpacing],
  );
  // Ink/surfaces resolve at render time. Keeping them out of the engine is
  // what lets theme/AMOLED changes restyle the article without re-parsing it.
  const tagColors = useMemo(() => readerTagColors(palette), [palette]);
  // Pin untagged text to the reader, not the app/activity appearance.
  const baseStyle = useMemo(
    () => ({
      fontFamily: resolveFont(family),
      fontSize: base,
      lineHeight: readerLineHeight(base, lineSpacing),
    }),
    [family, base, lineSpacing],
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
      textStyle: { ...baseStyle, color: palette.onSurface },
      tagTextColors: tagColors.text,
      tagViewColors: tagColors.view,
      onTextSelect: (draft) => (onTextSelectRef.current ?? ignoreTextSelect)(draft),
    }) satisfies HighlightUiHandlers,
    [baseStyle, articlePlain, colors.highlight, colors.onHighlight, colors.selection, palette.onSurface, tagColors],
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
  if (contentWidth <= 0) return null;

  return (
    <HighlightUiContext.Provider value={highlightUi}>
    <TRenderEngineProvider
      baseStyle={baseStyle}
      tagsStyles={tagsStyles}
      classesStyles={ARTICLE_CLASSES_STYLES}
      systemFonts={SYSTEM_FONTS}
      ignoredStyles={READER_IGNORED_INLINE_STYLES}
    >
    <RenderHTMLConfigProvider
      renderersProps={renderersProps}
      renderers={ARTICLE_RENDERERS}
      defaultTextProps={defaultTextProps}
    >
      <ArticleSections sections={sections} contentWidth={contentWidth} onReady={onReady} workScheduler={workScheduler} />
    </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
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
