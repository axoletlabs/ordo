/** Window traits affect density, never the number of content panes. */
export function responsiveLayout(width: number, height: number, fontScale = 1) {
  const textScale = Math.max(1, fontScale);
  const isLandscape = width > height;
  return {
    isLandscape,
    isTablet: Math.min(width, height) >= 600,
    isWide: width >= 600,
    compactHeight: height / textScale < 480,
    inlineLibraryHeader: isLandscape || width / textScale >= 600,
    showLibraryTitle: width / textScale >= 600,
  };
}
