/**
 * One delayed, cancellable focus take for an opening picker on web.
 *
 * Native pickers do not use this timer: the shared Input focus scope waits
 * for the owning overlay to measure, then performs the field's initial native
 * focus once per opening session. On web, a picker hands keyboard ownership
 * to its search field, but only when the user has not already chosen a
 * target. The take belongs to exactly one open session: closing the owner,
 * remounting, or any pointer/key interaction with the picker cancels it. If
 * the picker body mounts after the timer, the take waits for its field (via
 * the returned `onLayout`) instead of focusing a stale or absent node. An
 * editable control already focused inside the picker wins; a menu row that
 * only received the touch browser's synthesized post-open-click focus does
 * not.
 *
 * Local to the bookmark pickers; promote to a shared hook only with an agreed
 * owner API.
 */
import React from "react";
import { Platform } from "react-native";

/** Let the picker's entrance settle before the IME retargets to its search. */
export const OPENING_FOCUS_DELAY_MS = 120;

type FocusTarget = { focus: () => void };
type FocusScope = { contains?: (node: unknown) => boolean };

/** A text-editing control already holds the keyboard; a menu row does not. */
function isEditableElement(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const element = node as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  return element.tagName === "INPUT"
    || element.tagName === "TEXTAREA"
    || element.tagName === "SELECT"
    || element.isContentEditable === true
    || element.getAttribute?.("contenteditable") === "true";
}

export interface OpeningFocusHandlers {
  onPointerDown: () => void;
  onLayout: () => void;
  onKeyDown: () => void;
}

export function useOpeningFocus<T extends FocusTarget, S>({
  active,
  targetRef,
  scopeRef,
}: {
  /** The picker is open and this session owns keyboard focus. */
  active: boolean;
  /** Search field; may be absent until the picker body mounts. */
  targetRef: React.RefObject<T | null>;
  /** Picker content, so focus the user already placed wins on web. */
  scopeRef?: React.RefObject<S | null>;
}): OpeningFocusHandlers {
  const live = React.useRef(active);
  // Publish ownership only for committed renders. A discarded concurrent
  // render must not cancel a pending take that still belongs to the live
  // picker (or invent one for a render that never committed).
  React.useLayoutEffect(() => {
    live.current = active;
  }, [active]);
  const session = React.useRef(0);
  const pending = React.useRef(false);
  const deliberate = React.useRef(false);

  const take = React.useCallback(() => {
    if (!live.current || deliberate.current) return;
    const target = targetRef.current;
    if (!target) {
      // The menu is still measuring; the content's first layout retries.
      pending.current = true;
      return;
    }
    pending.current = false;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const scope = scopeRef?.current as unknown as FocusScope | null;
      const focused = document.activeElement;
      // Only an editable control already inside the picker keeps the
      // keyboard. A non-editable menu row focused without any interaction
      // event is the touch browser's synthesized post-tap click (the opening
      // tap was outside the menu); the search take must still win there.
      // Genuine Tab/pointer navigation cancels the take through the handlers
      // above, so it never reaches this branch. Programmatic focus chosen by
      // the core focus hook stays put only while it lands on an editable
      // control; callers that intentionally focus a menu row should cancel
      // this take instead of relying on DOM focus alone.
      if (focused && focused === (target as unknown)) return;
      if (scope && focused && scope.contains?.(focused) && isEditableElement(focused)) return;
    }
    target.focus();
  }, [scopeRef, targetRef]);

  React.useEffect(() => {
    session.current += 1;
    const token = session.current;
    deliberate.current = false;
    pending.current = false;
    if (!active) return;
    const timer = setTimeout(() => {
      if (token !== session.current) return;
      take();
    }, OPENING_FOCUS_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (token === session.current) {
        session.current += 1;
        pending.current = false;
      }
    };
  }, [active, take]);

  const cancel = React.useCallback(() => {
    // Once the user has navigated or typed, the delayed take has lost its
    // claim even if the session stays open.
    deliberate.current = true;
    pending.current = false;
  }, []);
  const settle = React.useCallback(() => {
    if (pending.current) take();
  }, [take]);

  return React.useMemo(() => ({
    onPointerDown: cancel,
    onKeyDown: cancel,
    onLayout: settle,
  }), [cancel, settle]);
}
