import { createContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

/** Overlay inputs may request their initial native focus only after their
 * owner has measured and started opening. A suspended/closing owner must
 * cancel that request rather than replay it when a child picker closes. */
export interface InputFocusScope {
  active: boolean;
  ready: boolean;
  /** A fresh opening, unlike resuming after a child picker. */
  session: number;
  /** Stable identity of the surface that owns this scope. Native focus is
   * owned by exactly one portal sibling; this token lets every field and the
   * background refuse a focus move that belongs to another surface. */
  owner: number;
}

export const InputFocusScopeContext = createContext<InputFocusScope | null>(null);

/** A native text field registered with its owning overlay scope. */
export interface NativeFocusField {
  /** The field may currently accept the keyboard. */
  canFocus: () => boolean;
  /** Focus the native input. The implementation applies its own owner,
   * editability, and app-state checks again at call time. */
  focus: () => void;
}

type NativeScope = {
  owner: number;
  active: boolean;
  ready: boolean;
  /** This owner held the surface before a child picker/panel covered it. */
  suspended: boolean;
  /** The owner has come back and is waiting for the top layer to settle. */
  resumePending: boolean;
  lastFocused: object | null;
  fields: Map<object, NativeFocusField>;
  activatedAt: number;
};

/** Native has one focus system spanning every portal sibling. These records
 * are committed-state only: they are published from layout effects, so a
 * discarded concurrent render cannot change which surface owns focus. */
const nativeScopes = new Map<number, NativeScope>();
let nextOwner = 0;
let activationClock = 0;
let reconcileQueued = false;

function nativeOwnedScope(owner: number): NativeScope {
  let scope = nativeScopes.get(owner);
  if (!scope) {
    scope = {
      owner,
      active: false,
      ready: false,
      suspended: false,
      resumePending: false,
      lastFocused: null,
      fields: new Map(),
      activatedAt: 0,
    };
    nativeScopes.set(owner, scope);
  }
  return scope;
}

/** The top interactive overlay. A newer activation always wins, matching the
 * portal layer order without relying on DOM ancestors (native has none). */
function topNativeScope(): NativeScope | null {
  let top: NativeScope | null = null;
  for (const scope of nativeScopes.values()) {
    if (!scope.active) continue;
    if (!top || scope.activatedAt >= top.activatedAt) top = scope;
  }
  return top;
}

function resumeField(scope: NativeScope): NativeFocusField | null {
  // Only a scope that had a real field focus may resume it. The exact field
  // wins; if it was removed while the child was open, the parent's first
  // editable field keeps the keyboard in this surface instead of the screen
  // behind it.
  if (!scope.lastFocused) return null;
  const previous = scope.fields.get(scope.lastFocused);
  if (previous?.canFocus()) return previous;
  for (const field of scope.fields.values()) {
    if (field.canFocus()) return field;
  }
  return null;
}

function restoreResumedScope() {
  reconcileQueued = false;
  const top = topNativeScope();
  if (!top || !top.resumePending) return;
  if (!top.ready) return;
  top.resumePending = false;
  const field = resumeField(top);
  if (field) field.focus();
}

/** Let every sibling's committed scope update land before choosing the top
 * owner; opening/closing a picker updates the parent and child in one commit. */
function queueNativeReconcile() {
  if (Platform.OS === "web" || reconcileQueued) return;
  reconcileQueued = true;
  Promise.resolve().then(restoreResumedScope);
}

/**
 * Whether a native field may keep a focus move. A field outside every overlay
 * scope is background; while an overlay owns the screen it must not retain
 * focus even if Android's removal fallback or an explicit focus() lands there.
 * A scoped field may take focus only while its own surface is the top owner.
 */
export function nativeFocusPermitted(owner: number | null): boolean {
  if (Platform.OS === "web") return true;
  const top = topNativeScope();
  if (top) return owner != null && top.owner === owner;
  return owner == null;
}

/** Register the native input behind an overlay scope. Stable ownership is keyed
 * by `field` (a token kept for the Input's lifetime), while the callbacks read
 * live refs so re-renders do not disturb the last real focus. */
export function registerNativeFocusField(owner: number, field: object, target: NativeFocusField) {
  if (Platform.OS === "web") return () => {};
  const scope = nativeOwnedScope(owner);
  scope.fields.set(field, target);
  return () => {
    const live = nativeScopes.get(owner);
    if (!live || live.fields.get(field) !== target) return;
    // Keep `lastFocused` if this token was the last field: the scope still had
    // a real focus intent, and a resume may fall back to its first remaining
    // field instead of dropping the keyboard onto the background.
    live.fields.delete(field);
  };
}

/** Record a real native focus event for the field's owner. Blur never clears
 * this: the field the user left is exactly what a resumed parent restores. */
export function markNativeFocus(owner: number, field: object) {
  if (Platform.OS === "web") return;
  const scope = nativeScopes.get(owner);
  if (scope) scope.lastFocused = field;
}

export function useInputFocusScope(active: boolean, ready: boolean, visible: boolean): InputFocusScope {
  // Render-adjusted state, rather than a mutable ref: a discarded concurrent
  // render must not invent a close/reopen and replay autofocus on the live UI.
  const [opening, setOpening] = useState({ visible, session: 0 });
  if (opening.visible !== visible) {
    setOpening({ visible, session: opening.session + Number(visible) });
  }
  const session = opening.session;
  // Stable for this hook instance, including retained close/reopen sessions.
  const ownerRef = useRef(0);
  if (ownerRef.current === 0) {
    nextOwner += 1;
    ownerRef.current = nextOwner;
  }
  const owner = ownerRef.current;

  // Publish committed ownership only. The background and every Input read this
  // registry synchronously from native focus events, so it must never reflect
  // a render React abandoned.
  useLayoutEffect(() => {
    if (Platform.OS === "web") return;
    const scope = nativeOwnedScope(owner);
    const wasActive = scope.active;
    scope.ready = ready;
    if (!visible) {
      // Closing is a fresh open next time, not a resume; never restore a field
      // from the previous session.
      scope.active = false;
      scope.suspended = false;
      scope.resumePending = false;
      scope.lastFocused = null;
    } else {
      if (active && !wasActive) {
        scope.activatedAt = ++activationClock;
        if (scope.suspended) scope.resumePending = true;
        scope.suspended = false;
      } else if (!active && wasActive) {
        // A child picker or obscured sibling owns the surface. Keep the field
        // the user left so the immediate parent can resume it.
        scope.suspended = true;
      }
      scope.active = active;
    }
    queueNativeReconcile();
  }, [active, owner, ready, visible]);

  useLayoutEffect(() => {
    if (Platform.OS === "web") return;
    return () => { nativeScopes.delete(owner); };
  }, [owner]);

  return useMemo(() => ({ active, ready, session, owner }), [active, ready, session, owner]);
}
