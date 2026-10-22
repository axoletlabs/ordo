import { createContext } from "react";

/** Committed panel lifetime, including its retained exit. Children may pause
 * optional work without confusing loss of focus with a fully hidden surface. */
export const PanelPresenceContext = createContext<{ visible: boolean; rendered: boolean } | null>(null);
