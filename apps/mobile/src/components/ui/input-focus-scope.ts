import { createContext, useMemo, useState } from "react";

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
  // Render-adjusted state, rather than a mutable ref: a discarded concurrent
  // render must not invent a close/reopen and replay autofocus on the live UI.
  const [opening, setOpening] = useState({ visible, session: 0 });
  if (opening.visible !== visible) {
    setOpening({ visible, session: opening.session + Number(visible) });
  }
  const session = opening.session;
  return useMemo(() => ({ active, ready, session }), [active, ready, session]);
}
