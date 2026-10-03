/** Lift a centered dialog only by its overlap with the keyboard. */
export function panelKeyboardLift(center: number, panelHeight: number, viewportHeight: number, topGap: number, bottomGap: number): number {
  const restingTop = center - panelHeight / 2;
  const top = Math.max(topGap, Math.min(restingTop, viewportHeight - bottomGap - panelHeight));
  return Math.min(0, top - restingTop);
}
