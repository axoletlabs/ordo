/** Web focus containment, menu keyboard navigation, Escape, and trigger restoration. */
import { useEffect, useRef } from "react";
import { Platform, type View } from "react-native";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
export function useOverlayFocus(active: boolean, onDismiss: () => void, kind: "dialog" | "menu", dismissible = true) {
  const ref = useRef<View>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof document === "undefined") return;
    const previous = document.activeElement as HTMLElement | null;
    const node = () => ref.current as unknown as HTMLElement | null;
    const items = () => Array.from(node()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((item) =>
      item.getAttribute("aria-disabled") !== "true" && item.getClientRects().length > 0);
    let frame = requestAnimationFrame(() => {
      // Portal publication happens in a layout effect; allow the host to attach.
      frame = requestAnimationFrame(() => {
        const preferred = kind === "dialog" ? node()?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])') : null;
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
      const rows = controls.filter((item) => item.getAttribute("role") === "menuitem");
      if (!rows.length) return;
      const current = rows.indexOf(document.activeElement as HTMLElement);
      const target = event.key === "ArrowDown" ? (current + 1) % rows.length
        : event.key === "ArrowUp" ? (current - 1 + rows.length) % rows.length
        : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
      if (target >= 0) { event.preventDefault(); rows[target].focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", key, true);
      const root = node();
      if (previous?.isConnected && (root?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, [active, kind, dismissible]);
  return ref;
}
