import { createContext, useMemo, useRef } from "react";

/** Overlay inputs may request their initial native focus only after their
 * owner has measured and started opening. A suspended/closing owner must
 * cancel that request rather than replay it when a child picker closes. */
export interface InputFocusScope {
  active: boolean;
  ready: boolean;
  /** A fresh opening, unlike resuming after a child picker. */
  session: number;
}

export const InputFocusScopeContext = createContext<InputFocusScope | null>(null);

export function useInputFocusScope(active: boolean, ready: boolean, visible: boolean): InputFocusScope {
  const opening = useRef({ visible, session: 0 });
  if (opening.current.visible !== visible) {
    opening.current.visible = visible;
    if (visible) opening.current.session += 1;
  }
  const session = opening.current.session;
  return useMemo(() => ({ active, ready, session }), [active, ready, session]);
}
