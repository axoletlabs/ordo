/**
 * Which library row owns the open context menu. Rows subscribe to a boolean
 * selector so opening a menu does not re-render the whole list.
 */
import { create } from "zustand";
import type { SelectionKey } from "./use-selection";

export const useMenuHighlightStore = create<{
  key: SelectionKey | null;
  set: (key: SelectionKey | null) => void;
}>((set) => ({
  key: null,
  set: (key) => set({ key }),
}));
