/** Invert resistance when regrabbing so the next frame stays continuous. */
export function sheetDragOrigin(position: number) {
  "worklet";
  return position >= 0 ? position : position / Math.max(0.001, 1 + position / 120);
}
export function sheetDragPosition(origin: number, translation: number) {
  "worklet";
  const raw = origin + translation;
  return raw >= 0 ? raw : raw / (1 - raw / 120);
}
export function shouldDismissSheet(position: number, velocity: number) {
  "worklet";
  return position > 64 || position > 8 && velocity > 800;
}
