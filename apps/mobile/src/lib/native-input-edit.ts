/** Typed text already exists natively; external edits must replace it, even while focused. */
export function nativeInputEdit(next: string | undefined, applied: string | undefined, focused: boolean) {
  if (next === applied) return "none";
  return focused ? "replace" : "remount";
}
