/** Web focus containment, menu keyboard navigation, Escape, and trigger restoration. */
import { useEffect, useLayoutEffect, useRef } from "react";
import { Platform, type View } from "react-native";
import { isolateModal } from "../lib/modal-isolation";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
/** Portal publication can take one extra commit. No wall-clock polling. */
const MAX_PUBLISH_FRAMES = 2;
const MAX_FOCUS_FRAMES = 3;
const MAX_TRIGGER_CHAIN = 6;

type FocusSession = {
  alive: boolean;
  active: boolean;
  root: HTMLElement | null;
  trigger: HTMLElement | null;
  focusPending: boolean;
  focusFrame: number;
  focusToken: number;
  focusAttempts: number;
  /** A child picker suspended this owner; resume may repair, never open-focus. */
  suspended: boolean;
  lastFocus: HTMLElement | null;
  resumeFrame: number;
  resumeToken: number;
  repairFrame: number;
  restoreFrame: number;
  restoreToken: number;
  restoreObserver: MutationObserver | null;
  restoring: boolean;
  restorePending: boolean;
  resumeWake: (() => void) | null;
};

/** A closing menu/dialog hands its trigger to the surface that replaces it.
 * Weak keys keep retained exit trees from extending their lifetime. */
const triggerByRoot = new WeakMap<HTMLElement, HTMLElement>();
const openRoots = new WeakSet<HTMLElement>();
/** A newer session/close owns the next restoration. Older observers must not
 * wake up later and move focus behind the newest surface. */
let restoreGeneration = 0;
/** Child restores that may still place focus inside a resuming parent. */
let activeRestores = 0;
const restoreWaiters = new Set<() => void>();

function notifyRestoreFinished() {
  for (const waiter of [...restoreWaiters]) waiter();
}

function overlayRoots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-material-overlay="true"]'));
}

function topOverlay(): HTMLElement | undefined {
  const roots = overlayRoots();
  return roots[roots.length - 1];
}

function rememberTrigger(root: HTMLElement | null, trigger: HTMLElement | null) {
  if (!root || !trigger || trigger === root || root.contains(trigger)) return;
  triggerByRoot.set(root, trigger);
}

/** A menu/dialog opened from this surface from inside its own contents is a
 * child surface, even though the portal makes it a DOM sibling. */
function ownsSurface(surface: HTMLElement, root: HTMLElement | null): boolean {
  if (!root) return false;
  if (surface === root || surface.contains(root) || root.contains(surface)) return true;
  const trigger = triggerByRoot.get(surface);
  return Boolean(trigger && (trigger === root || root.contains(trigger)));
}

/** Follow the launch chain through overlays that are already closing, so the
 * Save dialog opened from a dismissed menu restores the menu's trigger, not
 * the menu item that is about to be removed. A still-open (or merely
 * suspended) parent is the real trigger and stops the chain. */
function resolveTrigger(element: Element | null, ownRoot: HTMLElement | null): HTMLElement | null {
  let target = element instanceof HTMLElement ? element : null;
  for (let step = 0; step < MAX_TRIGGER_CHAIN && target; step += 1) {
    if (!target.isConnected || target === document.body || target === document.documentElement) return null;
    // A field inside the surface being opened is not a launch trigger.
    if (ownRoot && (target === ownRoot || ownRoot.contains(target))) return null;
    const container = target.closest<HTMLElement>("[data-material-overlay]");
    if (!container || container === ownRoot || openRoots.has(container)) break;
    const parentTrigger = triggerByRoot.get(container);
    if (!parentTrigger || parentTrigger === target) break;
    target = parentTrigger;
  }
  return target;
}

function clearResumeWake(session: FocusSession) {
  if (!session.resumeWake) return;
  restoreWaiters.delete(session.resumeWake);
  session.resumeWake = null;
}

function cancelRestore(session: FocusSession) {
  session.restoreToken += 1;
  if (session.restoreFrame) cancelAnimationFrame(session.restoreFrame);
  session.restoreFrame = 0;
  session.restoreObserver?.disconnect();
  session.restoreObserver = null;
  session.restoring = false;
  clearResumeWake(session);
  if (session.restorePending) {
    session.restorePending = false;
    activeRestores = Math.max(0, activeRestores - 1);
    notifyRestoreFinished();
  }
}

export function useOverlayFocus(active: boolean, onDismiss: () => void, kind: "dialog" | "menu", dismissible = true, isolateBackground = false, suspended = false, onNavigate?: (key: string) => boolean) {
  const ref = useRef<View>(null);
  const dismissRef = useRef(onDismiss);
  const navigateRef = useRef(onNavigate);
  const sessionRef = useRef<FocusSession | null>(null);
  const mountedRef = useRef(false);
  const activeRef = useRef(active);
  const suspendedRef = useRef(suspended);

  // Publish only committed ownership. Writing these during render would let a
  // discarded concurrent render change close/restoration for the live tree.
  // Layout effects run before passive cleanup, so the next key/focusin/
  // cleanup sees the same committed generation.
  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
    navigateRef.current = onNavigate;
    activeRef.current = active;
    suspendedRef.current = suspended;
  }, [onDismiss, onNavigate, active, suspended]);

  // One owner for the whole component lifetime. A close can schedule a
  // restore for a later isolation release; unmount must cancel it, otherwise
  // the old page's trigger can receive focus after navigation.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (!session) return;
      session.alive = false;
      if (session.root) openRoots.delete(session.root);
      cancelRestore(session);
      if (session.focusFrame) cancelAnimationFrame(session.focusFrame);
      if (session.resumeFrame) cancelAnimationFrame(session.resumeFrame);
      if (session.repairFrame) cancelAnimationFrame(session.repairFrame);
    };
  }, []);

  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof document === "undefined") return;
    const node = () => ref.current as unknown as HTMLElement | null;
    const items = () => Array.from(node()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((item) =>
      item.getAttribute("aria-disabled") !== "true" && !item.closest('[inert], [aria-hidden="true"]') && item.getClientRects().length > 0);

    // Start or resume a session before any suspended return so a surface
    // opened as a sibling still owns its trigger when it becomes interactive.
    let session = sessionRef.current;
    const reopening = Boolean(session && session.restoring && session.trigger?.isConnected);
    const retainedOpeningFocus = reopening ? document.activeElement : null;
    if (!session || (!session.active && !reopening)) {
      restoreGeneration += 1;
      const root = node();
      const trigger = resolveTrigger(document.activeElement, root);
      session = {
        alive: true, active: true, root, trigger,
        focusPending: !suspended,
        focusFrame: 0, focusToken: 0, focusAttempts: 0,
        suspended,
        lastFocus: null,
        resumeFrame: 0, resumeToken: 0, resumeWake: null,
        repairFrame: 0,
        restoreFrame: 0, restoreToken: 0, restoreObserver: null, restoring: false, restorePending: false,
      };
      sessionRef.current = session;
    } else if (!session.active) {
      // A fresh opening keeps the original launch trigger, not the old
      // retained control (e.g. Paste). Only a child resume keeps lastFocus.
      restoreGeneration += 1;
      cancelRestore(session);
      // Closing evacuated focus from the retained tree. If nothing else has
      // taken it, resume the field the user was in once the surface returns.
      session.active = true;
      session.alive = true;
      session.lastFocus = null;
      session.focusPending = !suspended;
    }
    const root = node();
    if (root) {
      session.root = root;
      rememberTrigger(root, session.trigger);
      openRoots.add(root);
    }

    if (suspended) {
      session.suspended = true;
      return;
    }
    const resumingFromChild = session.suspended;
    session.suspended = false;

    let releaseIsolation: (() => void) | undefined;
    let observer: MutationObserver | undefined;
    const isTop = () => {
      const current = node();
      return Boolean(current && topOverlay() === current);
    };

    const isolate = () => {
      const current = node();
      if (!current || releaseIsolation || !isolateBackground) return;
      releaseIsolation = isolateModal(current);
    };

    const focusFirst = () => {
      const current = node();
      if (!current) return;
      session!.root = current;
      rememberTrigger(current, session!.trigger);
      isolate();
      if (topOverlay() !== current) { session!.focusPending = false; return; }
      // Returning from a dropdown keeps its restored trigger focus.
      if (current.contains(document.activeElement) && document.activeElement !== current
        && document.activeElement !== retainedOpeningFocus) {
        session!.focusPending = false;
        return;
      }
      const controls = items();
      const previous = session!.lastFocus;
      const reusable = previous && previous.isConnected && previous !== current && current.contains(previous)
        && previous.getClientRects().length > 0 && !previous.closest('[inert], [aria-hidden="true"]')
        && previous.getAttribute("aria-disabled") !== "true" && !previous.matches(":disabled");
      const preferred = kind === "dialog"
        ? controls.find((item) => /INPUT|TEXTAREA/.test(item.tagName) && !item.hasAttribute("readonly")) : null;
      const fallback = kind === "dialog" ? controls.find((item) => !item.hasAttribute("readonly")) : null;
      (reusable ? previous! : preferred ?? fallback ?? controls[0] ?? current).focus?.({ preventScroll: true });
      session!.focusPending = false;
    };

    // A child picker restores its own trigger. Only if that leaves focus on
    // body, this dialog's root, a hidden/closing child, or nothing at all do
    // we reclaim the field the user left; a valid user/child move wins.
    const scheduleResume = () => {
      clearResumeWake(session!);
      const token = ++session!.resumeToken;
      let attempts = 0;
      const step = () => {
        session!.resumeFrame = 0;
        clearResumeWake(session!);
        if (!session!.alive || !session!.active || suspendedRef.current || token !== session!.resumeToken) return;
        const current = node();
        if (!current) {
          attempts += 1;
          if (attempts < MAX_PUBLISH_FRAMES) session!.resumeFrame = requestAnimationFrame(step);
          return;
        }
        const focused = document.activeElement as HTMLElement | null;
        const insideField = Boolean(focused && focused !== current && current.contains(focused));
        if (insideField) return;
        // Another live surface still owns focus; do not reach underneath it.
        if (topOverlay() && topOverlay() !== current) return;
        const outsideValid = Boolean(focused && focused !== document.body && !focused.closest('[inert], [aria-hidden="true"]')
          && !focused.closest('[data-material-overlay="false"]'));
        if (outsideValid) return;
        const previous = session!.lastFocus;
        const previousValid = Boolean(previous?.isConnected && previous !== current && current.contains(previous)
          && previous.getClientRects().length > 0 && !previous.closest('[inert], [aria-hidden="true"]')
          && previous.getAttribute("aria-disabled") !== "true" && !previous.matches(":disabled"));
        if (previousValid) { previous!.focus({ preventScroll: true }); return; }
        // A child restore that has not finished yet may still place focus on
        // its trigger (possibly after exit isolation releases). Wait for that
        // completion instead of guessing the first field and bouncing the IME.
        if (activeRestores > 0) {
          const wake = () => {
            if (session!.resumeWake !== wake) return;
            session!.resumeWake = null;
            if (token === session!.resumeToken) session!.resumeFrame = requestAnimationFrame(step);
          };
          session!.resumeWake = wake;
          restoreWaiters.add(wake);
          return;
        }
        // The child may still be publishing its (possibly removed) trigger.
        // Give its bounded publication frames a chance before choosing the
        // dialog's first field; never flash a background search in between.
        if (attempts < MAX_PUBLISH_FRAMES) {
          attempts += 1;
          session!.resumeFrame = requestAnimationFrame(step);
          return;
        }
        const controls = items();
        const fallback = controls.find((item) => !item.hasAttribute("readonly")) ?? controls[0] ?? current;
        fallback.focus?.({ preventScroll: true });
      };
      session!.resumeFrame = requestAnimationFrame(step);
    };

    const scheduleFocus = () => {
      if (!session!.focusPending) return;
      const token = ++session!.focusToken;
      const step = () => {
        session!.focusFrame = 0;
        if (!session!.alive || !session!.active || token !== session!.focusToken || !session!.focusPending) return;
        if (!node()) {
          session!.focusAttempts += 1;
          if (session!.focusAttempts < MAX_FOCUS_FRAMES) session!.focusFrame = requestAnimationFrame(step);
          else session!.focusPending = false;
          return;
        }
        focusFirst();
      };
      session!.focusFrame = requestAnimationFrame(step);
    };
    scheduleFocus();
    if (resumingFromChild) scheduleResume();

    const current = node();
    if (current) {
      // Replacing a nested menu page removes its focused row without firing
      // focusin. Keep keyboard ownership instead of leaving focus on body.
      observer = new MutationObserver(() => {
        // Most content updates leave focus intact. Don't wake a repair
        // frame for every keystroke, loading label or appended list batch.
        if (current.contains(document.activeElement) || !session!.alive
          || suspendedRef.current || !activeRef.current || !isTop()) return;
        cancelAnimationFrame(session!.repairFrame);
        session!.repairFrame = requestAnimationFrame(() => {
          const live = node();
          if (!live || !session!.alive || !session!.active || suspendedRef.current || !activeRef.current
            || !isTop() || live.contains(document.activeElement)) return;
          (items()[0] ?? live).focus({ preventScroll: true });
        });
      });
      observer.observe(current, { childList: true, subtree: true });
    }

    const key = (event: KeyboardEvent) => {
      const live = node();
      // A child opening sets suspended/active in the same render; the old
      // listener can survive until passive cleanup. It must not consume
      // Escape or Tab for the parent during that handoff.
      if (!live || suspendedRef.current || !activeRef.current || !isTop()) return;
      if (event.key === "Escape" && dismissible) {
        event.preventDefault(); event.stopPropagation(); dismissRef.current(); return;
      }
      if (event.key !== "Tab" && !(kind === "menu" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))) return;
      const controls = items();
      if (!controls.length) { if (event.key === "Tab") event.preventDefault(); return; }
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Tab") {
        if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
      }
      if (kind !== "menu" || /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName ?? "")) return;
      // A virtualized catalogue must navigate its data, not just mounted rows.
      if (navigateRef.current?.(event.key)) { event.preventDefault(); return; }
      const rows = controls.filter((item) => item.getAttribute("role")?.startsWith("menuitem"));
      if (!rows.length) return;
      const activeRow = rows.indexOf(document.activeElement as HTMLElement);
      const target = event.key === "ArrowDown" ? (activeRow + 1) % rows.length
        : event.key === "ArrowUp" ? (activeRow - 1 + rows.length) % rows.length
        : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
      if (target >= 0) { event.preventDefault(); rows[target].focus(); }
    };
    document.addEventListener("keydown", key, true);
    const containFocus = (event: FocusEvent) => {
      const live = node();
      if (live && !suspendedRef.current && activeRef.current && isTop() && !live.contains(event.target as Node)) {
        (items()[0] ?? live).focus();
      }
    };
    document.addEventListener("focusin", containFocus, true);
    return () => {
      // A dropdown (or dismissal) that arrives before the opening frame must
      // cancel the delayed focus instead of resuming it later.
      if (suspendedRef.current || !activeRef.current) session!.focusPending = false;
      // Remember the field the user left behind. A child picker restores its
      // own trigger when possible; this is the fallback if that row was
      // removed while the child was open.
      if (suspendedRef.current && activeRef.current && session!.active) {
        session!.suspended = true;
        const focused = document.activeElement as HTMLElement | null;
        if (focused && focused !== session!.root && session!.root?.contains(focused)) session!.lastFocus = focused;
      }
      if (session!.focusFrame) cancelAnimationFrame(session!.focusFrame);
      session!.focusFrame = 0;
      session!.focusToken += 1;
      if (session!.resumeFrame) cancelAnimationFrame(session!.resumeFrame);
      session!.resumeFrame = 0;
      session!.resumeToken += 1;
      clearResumeWake(session!);
      if (session!.repairFrame) cancelAnimationFrame(session!.repairFrame);
      session!.repairFrame = 0;
      observer?.disconnect();
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", containFocus, true);
      releaseIsolation?.();
    };
  }, [active, kind, dismissible, isolateBackground, suspended]);

  // Restoration belongs to the session, not to the transient interactive
  // state: a dropdown only suspends focus, it does not close the dialog.
  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof document === "undefined") return;
    const session = sessionRef.current;
    if (!session) return;
    cancelRestore(session);
    if (session.root) openRoots.add(session.root);
    return () => {
      const closing = sessionRef.current;
      if (!closing) return;
      if (closing.root) openRoots.delete(closing.root);
      closing.active = false;
      if (!mountedRef.current) return;
      const root = closing.root;
      const evacuate = () => {
        if (!closing.alive || closing.active || activeRef.current) return;
        const focused = document.activeElement as HTMLElement | null;
        const surface = focused?.closest<HTMLElement>("[data-material-overlay]");
        if (focused && (focused === root || root?.contains(focused)
          || (surface?.getAttribute("data-material-overlay") === "false" && ownsSurface(surface, root)))) {
          focused.blur();
        }
      };
      // A retained exit tree is already hidden/inert. Never leave keyboard
      // focus inside it while an exit animation or external isolation runs:
      // release to body now, then restore the trigger when it is focusable.
      const focused = document.activeElement as HTMLElement | null;
      const focusedSurface = focused?.closest<HTMLElement>("[data-material-overlay]");
      const focusInThisSurface = Boolean(focused && (focused === root || root?.contains(focused)));
      const focusInClosingChild = Boolean(focusedSurface && focusedSurface.getAttribute("data-material-overlay") === "false"
        && ownsSurface(focusedSurface, root));
      const focusInActiveSurface = focusedSurface?.getAttribute("data-material-overlay") === "true";
      if (focusInThisSurface && focused && focused !== root) closing.lastFocus = focused;
      // A replacement surface that is already published will take focus in
      // this handoff; keep its trigger capture intact until then.
      const successor = topOverlay();
      const handingOff = Boolean(successor && successor !== root && !successor.contains(root));
      if ((focusInThisSurface || focusInClosingChild) && !focusInActiveSurface && !handingOff) focused?.blur?.();
      if (!closing.trigger) {
        closing.restoreFrame = requestAnimationFrame(() => {
          closing.restoreFrame = 0;
          evacuate();
        });
        return;
      }
      const trigger = closing.trigger;
      const token = ++closing.restoreToken;
      // Session starts advance the generation; sibling closes in the same
      // task share it so the surviving outer trigger can still restore.
      const generation = restoreGeneration;
      closing.restoring = true;

      const finish = () => {
        if (closing.restoreToken !== token) return;
        closing.restoreToken += 1;
        if (closing.restoreFrame) cancelAnimationFrame(closing.restoreFrame);
        closing.restoreFrame = 0;
        closing.restoreObserver?.disconnect();
        closing.restoreObserver = null;
        closing.restoring = false;
        if (closing.restorePending) {
          closing.restorePending = false;
          activeRestores = Math.max(0, activeRestores - 1);
          notifyRestoreFinished();
        }
      };

      if (!trigger.isConnected) { finish(); return; }
      closing.restorePending = true;
      activeRestores += 1;

      // Isolation is released by the exiting overlay's own commit, often
      // after the close render. Observe that release instead of polling a
      // wall-clock deadline; every callback is cancelled by reopen/unmount.
      const observer = new MutationObserver(() => schedule());
      closing.restoreObserver = observer;
      for (let element: HTMLElement | null = trigger; element; element = element.parentElement) {
        observer.observe(element, { attributes: true, childList: true,
          attributeFilter: ["inert", "aria-hidden", "data-material-overlay"] });
      }
      const watchSurface = (surface: HTMLElement) => {
        observer.observe(surface, { attributes: true, attributeFilter: ["data-material-overlay", "aria-hidden"] });
        if (surface.parentElement) observer.observe(surface.parentElement, { childList: true });
      };

      let publishFrames = 0;
      const attempt = () => {
        closing.restoreFrame = 0;
        if (closing.restoreToken !== token || closing.restoring === false) return;
        // The portal may publish aria-hidden/data-material-overlay one commit
        // after its publisher closes. Do not trust that stale DOM flag. By the
        // first frame successor hooks have captured their triggers, so release
        // any remaining focus owned by this closed session before waiting for
        // exit isolation to release the background.
        evacuate();
        // A newer surface/close owns focus now. This observer is obsolete.
        if (generation !== restoreGeneration) { finish(); return; }
        if (!closing.alive || closing.active || !trigger.isConnected) { finish(); return; }
        // The exiting layer still owns the background until its isolation is
        // torn down. The observer wakes us on that attribute change.
        if (trigger.closest('[inert], [aria-hidden="true"]')) return;
        const top = topOverlay();
        if (top && top !== root && !top.contains(trigger)) {
          // A child picker/menu that is still finishing belongs to this
          // surface's flow; wait for it instead of dumping focus on body.
          if (ownsSurface(top, root)) { watchSurface(top); return; }
          finish();
          return;
        }
        if (top === root) {
          // The portal publishes the closing state in the same commit, with
          // one extra frame allowed for retained/batched surfaces.
          if (publishFrames < MAX_PUBLISH_FRAMES) { publishFrames += 1; schedule(); return; }
          finish(); return;
        }
        // A trigger inside a closing parent overlay belongs to that parent's
        // restoration, not to this nested surface.
        if (trigger.closest('[data-material-overlay="false"]')) { finish(); return; }
        const focused = document.activeElement as HTMLElement | null;
        const insideThisSurface = Boolean(root && (focused === root || root.contains(focused)));
        const focusedSurface = focused?.closest<HTMLElement>("[data-material-overlay]");
        const focusInChild = Boolean(focusedSurface && ownsSurface(focusedSurface, root));
        if (focused && focused !== trigger && focused !== document.body && !insideThisSurface && !focusInChild) { finish(); return; }
        if (trigger.getClientRects().length === 0) { finish(); return; }
        trigger.focus({ preventScroll: true });
        finish();
      };
      const schedule = () => {
        if (closing.restoreToken !== token || closing.restoreFrame) return;
        closing.restoreFrame = requestAnimationFrame(attempt);
      };
      schedule();
    };
  }, [active]);
  return ref;
}
