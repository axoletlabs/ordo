import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { ArticleHtmlProps } from "./ArticleHtml";
import { Skeleton } from "../ui/Skeleton";
import { spacing } from "../../theme/tokens";

let renderer: React.ComponentType<ArticleHtmlProps> | null = null;
let loading: Promise<typeof import("./ArticleHtml")> | null = null;

/** The HTML engine is content, not navigation chrome. Load it after shell paint. */
export function ReaderArticle(props: ArticleHtmlProps) {
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
    {(["100%", "92%", "68%"] as const).map((width) => <Skeleton key={width} width={width} height={16} />)}
  </View>;
}
