/** Dismiss only the top menu on outside scroll, never on its own scroll body. */
export function listenForMenuOutsideScroll(
  getMenu: () => HTMLElement | null,
  onDismiss: () => void,
  owner: Document = document,
): () => void {
  let dismissed = false;
  const outsideScroll = (event: Event) => {
    // Blurring a long single-line field resets its horizontal caret viewport.
    // That queued scroll can arrive after its picker opens; it is not a scroll
    // of the background page. Real wheel/touch gestures still dismiss below.
    if (event.type === "scroll" && /^(INPUT|TEXTAREA)$/.test((event.target as HTMLElement | null)?.tagName ?? "")) return;
    const menu = getMenu();
    if (!menu || dismissed) return;
    const overlays = owner.querySelectorAll('[data-material-overlay="true"]');
    if (overlays[overlays.length - 1] !== menu || menu.contains(event.target as Node)) return;
    // Consume the first outside gesture so the library cannot move underneath
    // the still-open menu. Later gestures scroll normally after dismissal.
    if (event.cancelable) event.preventDefault();
    dismissed = true;
    onDismiss();
  };
  const options = { capture: true, passive: false };
  owner.addEventListener("wheel", outsideScroll, options);
  owner.addEventListener("touchmove", outsideScroll, options);
  // Also catch scrollbar drags and scrolling already in flight when opened.
  owner.addEventListener("scroll", outsideScroll, true);
  return () => {
    owner.removeEventListener("wheel", outsideScroll, true);
    owner.removeEventListener("touchmove", outsideScroll, true);
    owner.removeEventListener("scroll", outsideScroll, true);
  };
}
