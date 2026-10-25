import { createContext } from "react";

/** A measured surface owns geometry motion for its subtree. Nested disclosures
 * and swaps commit their target layout once, avoiding springs that chase each
 * other's per-frame onLayout reports. Standalone content owns its own motion. */
export const ResizeOwnerContext = createContext(false);
