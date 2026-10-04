import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ArticleHtmlProps } from "./ArticleHtml";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

let renderer: React.ComponentType<ArticleHtmlProps> | null = null;
let loading: Promise<typeof import("./ArticleHtml")> | null = null;

/** The HTML engine is content, not navigation chrome. Load it after shell paint. */
export function ReaderArticle(props: ArticleHtmlProps) {
  const { palette } = useTheme();
  const [Renderer, setRenderer] = useState(() => renderer);
  const [paintedHtml, setPaintedHtml] = useState<string | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const html = props.html;
  useEffect(() => {
    let cancelled = false;
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        if (renderer) {
          setRenderer(() => renderer);
          setPaintedHtml(html);
          return;
        }
        loading ??= import("./ArticleHtml");
        void loading.then((module) => {
          renderer = module.ArticleHtml;
          if (!cancelled) { setRenderer(() => renderer); setPaintedHtml(html); }
        }).catch((error: unknown) => {
          loading = null;
          if (!cancelled) setFailure(error instanceof Error ? error : new Error("Couldn't load the reader."));
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
  }, [html]);
  if (failure) throw failure;
  if (Renderer && paintedHtml === html) return <Renderer {...props} />;
  return <View accessibilityLabel="Loading article" style={{ gap: spacing[12] }}>
    {["100%", "92%", "68%"].map((width) => <View key={width} style={[styles.line, {
      backgroundColor: palette.surfaceContainerHigh, width: width as `${number}%`,
    }]} />)}
  </View>;
}
const styles = StyleSheet.create({ line: { height: 16, borderRadius: radius.xs } });
