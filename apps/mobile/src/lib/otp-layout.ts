/** Preserve actual 48dp targets instead of squeezing six cells into a dialog. */
export function otpGroups(length: number, width: number, backup: boolean): number[][] {
  const split = backup && length === 8 ? width < 448 : width > 0 && width < length * 48;
  const indexes = Array.from({ length }, (_, index) => index);
  if (!split) return [indexes];
  const middle = Math.ceil(length / 2);
  return [indexes.slice(0, middle), indexes.slice(middle)];
}
