/** Right-anchored stretch with fixed-size caps and unscaled contents. */
export function stretchablePillGeometry(width: number, canvasWidth: number, height = 48) {
  "worklet";
  const extent = Math.max(height, canvasWidth);
  const paintedWidth = Math.min(extent, Math.max(height, width));
  const scale = paintedWidth / extent;
  const shift = (extent - paintedWidth) / 2;
  return {
    scale,
    shift,
    inverseScale: 1 / scale,
    inverseShift: -shift / scale,
    leadingShift: extent - paintedWidth,
    middleScale: extent > height ? (paintedWidth - height) / (extent - height) : 0,
  };
}
