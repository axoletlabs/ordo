/**
 * Sanitized semantic article HTML rendered with native views via
 * react-native-render-html — no WebView, no JavaScript.
 *
 * The server pipeline (Readability → sanitize-html) emits an allowlisted
 * semantic subset (p/headings/lists/blockquote/pre/code/figure/table/links,
 * http(s)/mailto schemes only, no scripts/iframes), so this component's job
 * is purely presentation: token-driven typography scaled by the reader
 * preferences, responsive images, select-to-share text, and external links.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  InteractionManager,
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
} from "react-native-render-html";
import { useTheme } from "../../theme/ThemeProvider";
import type { Palette } from "../../theme/theme";
import { radius, resolveFont, spacing, type FontFamily } from "../../theme/tokens";
import type { ReaderPreferences } from "@ordo/shared";
import { READER_BODY_SIZE, resolveReaderFontFamily } from "./reader-typography";
import {
  collectTableRows,
  plainTextFromNode,
  splitTableHeader,
} from "./article-html-table";

/** Custom fonts loaded via useFonts must be registered to avoid warnings. */
const SYSTEM_FONTS = [
  ...defaultSystemFonts,
  "Inter_400Regular",
  "Inter_500Medium",
  "Inter_600SemiBold",
  "Inter_700Bold",
  "InterTight_400Regular",
  "InterTight_500Medium",
  "InterTight_600SemiBold",
  "InterTight_700Bold",
  "JetBrainsMono_400Regular",
  "JetBrainsMono_500Medium",
  "JetBrainsMono_600SemiBold",
  "JetBrainsMono_700Bold",
  "PlayfairDisplay_400Regular",
  "PlayfairDisplay_700Bold",
  "PlayfairDisplay_400Regular_Italic",
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
): MixedStyleRecord {
  const bodyFont = (weight = "400") => resolveFont(family, weight);
  const monoSize = Math.max(12, base - 2);
  const cell = {
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[10],
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
  };

  return {
    p: {
      fontFamily: bodyFont(),
      fontSize: base,
      lineHeight: Math.round(base * 1.65),
      color: palette.textSecondary,
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
      fontFamily: family === "serif" ? resolveFont(family, "400", true) : undefined,
      fontStyle: "italic",
    },
    i: {
      fontFamily: family === "serif" ? resolveFont(family, "400", true) : undefined,
      fontStyle: "italic",
    },
    a: { color: palette.accent, textDecorationLine: "underline" },
    ul: { marginTop: spacing[12], marginBottom: spacing[8] },
    ol: { marginTop: spacing[12], marginBottom: spacing[8] },
    li: {
      fontFamily: bodyFont(),
      fontSize: base,
      lineHeight: Math.round(base * 1.6),
      color: palette.textSecondary,
      marginBottom: spacing[6],
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: palette.accent,
      backgroundColor: palette.surfaceSecondary,
      paddingHorizontal: spacing[14],
      paddingVertical: spacing[10],
      borderRadius: 6,
      marginTop: spacing[16],
    },
    pre: {
      fontFamily: resolveFont("mono", "400"),
      fontSize: monoSize,
      lineHeight: Math.round(monoSize * 1.55),
      color: palette.textSecondary,
      backgroundColor: palette.surfaceSecondary,
      paddingHorizontal: spacing[14],
      paddingVertical: spacing[12],
      borderRadius: 10,
      marginTop: spacing[16],
    },
    code: {
      fontFamily: resolveFont("mono", "400"),
      fontSize: monoSize,
      color: palette.text,
      backgroundColor: palette.surfaceSecondary,
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
    img: { borderRadius: 8 },
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
    mark: { backgroundColor: palette.accentSoft, color: palette.text },
    small: { fontSize: Math.max(11, base - 3) },
  };
}

export interface ArticleHtmlProps {
  html: string;
  preferences: ReaderPreferences;
  /** Measured width available to the article; drives responsive images. */
  contentWidth: number;
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

const headingRenderer: CustomBlockRenderer = ({ tnode, TDefaultRenderer, ...props }) => {
  const { onHeadingRef } = useRendererProps(tnode.tagName as "h1") as HeadingRendererProps;
  const setRef = useCallback(
    (view: ViewType | null) => {
      if (tnode.id) onHeadingRef?.(tnode.id, view);
    },
    [onHeadingRef, tnode.id],
  );

  return (
    <View ref={setRef} collapsable={false}>
      <TDefaultRenderer tnode={tnode} {...props} />
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
        { borderColor: palette.border, backgroundColor: palette.surfaceSecondary },
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
              <TNodeChildrenRenderer tnode={cell as TNode} />
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
  table: tableRenderer,
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

export const ArticleHtml = React.memo(function ArticleHtml({
  html,
  preferences,
  contentWidth,
  onHeadingsChange,
  onHeadingRef,
  onReady,
}: ArticleHtmlProps) {
  const { palette } = useTheme();
  const family = resolveReaderFontFamily(preferences.fontFamily);
  const base = READER_BODY_SIZE[preferences.fontSize];
  const [readyHtml, setReadyHtml] = useState<string | null>(null);

  // Let the reader chrome commit (and the push animation run) before building
  // a native view tree. Large tables otherwise freeze the JS thread on open.
  useEffect(() => {
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setReadyHtml(html);
      });
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [html]);
  const ready = readyHtml === html;

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [ready, onReady]);

  const tagsStyles = useMemo(
    () => buildTagsStyles(palette, family, base),
    [palette, family, base],
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
  if (!ready) {
    return (
      <View>
        <View style={[styles.placeholder, { backgroundColor: palette.surfaceSecondary }]} />
        <View
          style={[
            styles.placeholder,
            styles.placeholderShort,
            { backgroundColor: palette.surfaceSecondary },
          ]}
        />
        <View
          style={[
            styles.placeholder,
            styles.placeholderMid,
            { backgroundColor: palette.surfaceSecondary },
          ]}
        />
      </View>
    );
  }

  return (
    <RenderHTML
      source={{ html }}
      contentWidth={contentWidth}
      tagsStyles={tagsStyles}
      renderersProps={renderersProps}
      renderers={ARTICLE_RENDERERS}
      domVisitors={domVisitors}
      onTTreeChange={handleTreeChange}
      systemFonts={SYSTEM_FONTS}
      defaultTextProps={{ selectable: true }}
    />
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
  placeholder: {
    height: 16,
    borderRadius: radius.xs,
    marginTop: spacing[14],
  },
  placeholderShort: { width: "92%" },
  placeholderMid: { width: "68%" },
});
