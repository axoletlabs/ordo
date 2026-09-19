/**
 * Chrome walks the caret one extra character on Backspace/Delete when an
 * <input> sits in a rounded overflow-hidden (or transformed) ancestor — most
 * visible with the caret in the middle of the string. Compute where the caret
 * should land so the field can snap it back.
 */
export function caretAfterKey(start: number, end: number, key: string): number | null {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (key === "Backspace") return from === to ? Math.max(0, from - 1) : from;
  if (key === "Delete") return from;
  return null;
}

export function shouldCorrectWebCaret(event: {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.key === "Backspace" || event.key === "Delete";
}
