/** Safe area is added once, outside the app bar's own visual height. */
export function appBarLayout({ topInset = 0, safeTop = true, tonal = false, compact = false }: {
  topInset?: number; safeTop?: boolean; tonal?: boolean; compact?: boolean;
}) {
  const height = compact ? 56 : 64;
  const inset = tonal && !compact ? 4 : 0;
  return { paddingTop: (safeTop ? topInset : 0) + inset, paddingBottom: inset,
    minHeight: height - inset * 2, height };
}
