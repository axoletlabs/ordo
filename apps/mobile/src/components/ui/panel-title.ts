import { createContext } from "react";
/** Connects a portaled dialog to its visible title, including titles inside fragments. */
export const PanelTitleContext = createContext<string | undefined>(undefined);
