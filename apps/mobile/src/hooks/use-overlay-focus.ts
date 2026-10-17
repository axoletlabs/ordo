/** Web focus containment, menu keyboard navigation, Escape, and trigger restoration. */
import { useEffect, useRef } from "react";
import { Platform, type View } from "react-native";
import { isolateModal } from "../lib/modal-isolation";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
export function useOverlayFocus(active: boolean, onDismiss: () => void, kind: "dialog" | "menu", dismissible = true, isolateBackground = false, suspended = false) {
  const ref = useRef<View>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!active || suspended || Platform.OS !== "web" || typeof document === "undefined") return;
    const node = () => ref.current as unknown as HTMLElement | null;
    let releaseIsolation: (() => void) | undefined;
    let observer: MutationObserver | undefined;
    let repairFrame = 0;
    const items = () => Array.from(node()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((item) =>
      item.getAttribute("aria-disabled") !== "true" && !item.closest('[inert], [aria-hidden="true"]') && item.getClientRects().length > 0);
    let frame = requestAnimationFrame(() => {
      // Portal publication happens in a layout effect; allow the host to attach.
      frame = requestAnimationFrame(() => {
        const root = node();
        if (isolateBackground && root) releaseIsolation = isolateModal(root);
        if (root) {
          // Replacing a nested menu page removes its focused row without firing
          // focusin. Keep keyboard ownership instead of leaving focus on body.
          observer = new MutationObserver(() => {
            cancelAnimationFrame(repairFrame);
            repairFrame = requestAnimationFrame(() => {
              const overlays = document.querySelectorAll('[data-material-overlay="true"]');
              if (overlays[overlays.length - 1] === root && !root.contains(document.activeElement)) (items()[0] ?? root).focus();
            });
          });
          observer.observe(root, { childList: true, subtree: true });
        }
        // Returning from a dropdown should preserve its restored trigger focus.
        if (node()?.contains(document.activeElement) && document.activeElement !== node()) return;
        const preferred = kind === "dialog" ? items().find((item) => /INPUT|TEXTAREA/.test(item.tagName) && !item.hasAttribute("readonly")) : null;
        (preferred ?? items()[0] ?? node())?.focus?.();
      });
    });
    const key = (event: KeyboardEvent) => {
      const root = node();
      if (!root) return;
      const overlays = document.querySelectorAll('[data-material-overlay="true"]');
      if (overlays[overlays.length - 1] !== root) return;
      if (event.key === "Escape" && dismissible) {
        event.preventDefault(); event.stopPropagation(); dismissRef.current(); return;
      }
      const controls = items();
      if (!controls.length) { if (event.key === "Tab") event.preventDefault(); return; }
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Tab") {
        if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
      }
      if (kind !== "menu" || /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName ?? "")) return;
      const rows = controls.filter((item) => item.getAttribute("role")?.startsWith("menuitem"));
      if (!rows.length) return;
      const current = rows.indexOf(document.activeElement as HTMLElement);
      const target = event.key === "ArrowDown" ? (current + 1) % rows.length
        : event.key === "ArrowUp" ? (current - 1 + rows.length) % rows.length
        : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
      if (target >= 0) { event.preventDefault(); rows[target].focus(); }
    };
    document.addEventListener("keydown", key, true);
    const containFocus = (event: FocusEvent) => {
      const root = node();
      const overlays = document.querySelectorAll('[data-material-overlay="true"]');
      if (root && overlays[overlays.length - 1] === root && !root.contains(event.target as Node)) (items()[0] ?? root).focus();
    };
    document.addEventListener("focusin", containFocus, true);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(repairFrame);
      observer?.disconnect();
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", containFocus, true);
      releaseIsolation?.();
    };
  }, [active, kind, dismissible, isolateBackground, suspended]);
  // A dropdown temporarily owns focus, but does not end its parent dialog's
  // session. Restore the original trigger only when that session really closes,
  // after background isolation has been released by the effect above.
  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof document === "undefined") return;
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      const root = ref.current as unknown as HTMLElement | null;
      // The portal publishes its closing/resumed interactive state in a second
      // commit. Wait for that publication, otherwise the outgoing dialog still
      // looks like the top active overlay and blocks restoration to its trigger.
      // The deadline also rides out an exiting surface (tooltip or scrim) that
      // still holds focus, so the trigger is never restored under a dying layer.
      // The final rAF keeps the restore inside the same task that released
      // isolation; restoring too early puts focus on a still-inert trigger,
      // and Chromium then drops it to body without a second focus event.
      const deadline = Date.now() + 600;
      const restore = () => {
        const overlays = document.querySelectorAll('[data-material-overlay="true"]');
        const top = overlays[overlays.length - 1];
        const inertTrigger = previous?.isConnected && previous.closest('[inert]');
        if ((overlays.length || inertTrigger) && Date.now() < deadline) { requestAnimationFrame(restore); return; }
        requestAnimationFrame(() => {
          if (previous?.isConnected && !previous.closest('[data-material-overlay="false"]') &&
            (!top || top.contains(previous)) &&
            (document.activeElement === document.body || (root && root.contains(document.activeElement) && !root.contains(previous)))) previous.focus();
        });
      };
      requestAnimationFrame(restore);
    };
  }, [active]);
  return ref;
}
