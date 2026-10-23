/** Text already on the native field is not an edit; everything else must be
 * written into that same node so focus, autoFocus and the IME are undisturbed. */
export function nativeInputEdit(next: string | undefined, applied: string | undefined) {
  return next === applied ? "none" : "replace";
}
