import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { ArticleHtmlProps } from "./ArticleHtml";
import { Skeleton, SkeletonGroup } from "../ui/Skeleton";
import { spacing } from "../../theme/tokens";
import { useSceneReady } from "../../hooks/use-scene-ready";
import { scheduleIdleWork } from "../../lib/idle-work";
import { useAnimationActivity } from "../../hooks/use-animation-activity";

let renderer: React.ComponentType<ArticleHtmlProps> | null = null;
let loading: Promise<typeof import("./ArticleHtml")> | null = null;

/** The HTML engine is content, not navigation chrome. Load it after shell paint.
 * Memoized: reader chrome/progress/selection updates must not re-render the
 * article wrapper (and its scene/activity subscriptions) for unchanged props. */
export const ReaderArticle = React.memo(function ReaderArticle(props: ArticleHtmlProps) {
  const [Renderer, setRenderer] = useState(() => renderer);
  const [paintedHtml, setPaintedHtml] = useState<string | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const html = props.html;
  const sceneReady = useSceneReady();
  const active = useAnimationActivity();
  useEffect(() => {
    if (!sceneReady || !active || paintedHtml === html) return;
    let cancelled = false;
    const cancel = scheduleIdleWork(() => {
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
    return () => { cancelled = true; cancel(); };
  }, [active, html, paintedHtml, sceneReady]);
  if (failure) throw failure;
  if (Renderer && paintedHtml === html) return <Renderer {...props} />;
  return <SkeletonGroup><View accessibilityLabel="Loading article" style={{ gap: spacing[12] }}>
    {(["100%", "92%", "68%"] as const).map((width) => <Skeleton key={width} width={width} height={16} />)}
  </View></SkeletonGroup>;
});
