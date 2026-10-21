/** A newly mounted backdrop must not consume the synthesized click from the
 * long-press/touch that opened it. A real tap starts on this backdrop; keyboard
 * and assistive activation are explicit virtual clicks (detail zero). */
export function createScrimPressGuard() {
  let startedHere = false;
  return {
    begin() { startedHere = true; },
    reset() { startedHere = false; },
    consume(web: boolean, event: unknown) {
      const owned = startedHere;
      startedHere = false;
      const activation = (event ?? {}) as { detail?: number; type?: string };
      return !web || owned || activation.detail === 0 || activation.type === "keydown" || activation.type === "keyup";
    },
  };
}
