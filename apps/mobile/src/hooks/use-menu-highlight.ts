/**
 * Which library row owns the open context menu. Rows subscribe to a boolean
 * selector so opening a menu does not re-render the whole list.
 */
import { create } from "zustand";
import { useLayoutEffect } from "react";
import type { SelectionKey } from "./use-selection";

export const useMenuHighlightStore = create<{
  key: SelectionKey | null;
  owner: object | null;
  claim: (key: SelectionKey) => () => void;
}>((set, get) => ({
  key: null,
  owner: null,
  claim: (key) => {
    const owner = {};
    set({ key, owner });
    return () => {
      // Two mounted screens can own the same bookmark key. An old screen's
      // cleanup must not clear a newer session just because their keys match.
      if (get().owner === owner) set({ key: null, owner: null });
    };
  },
}));

/** Nested pages retain ownership while the action session is visible. Release
 * at dismissal so the row fades WITH the surface, not after its exit callback. */
export function useMenuHighlight(visible: boolean, key: SelectionKey | null) {
  useLayoutEffect(() => {
    if (visible && key) return useMenuHighlightStore.getState().claim(key);
  }, [visible, key]);
}
