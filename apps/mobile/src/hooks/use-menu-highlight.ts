/**
 * Which library row owns the open context menu. Rows subscribe to a boolean
 * selector so opening a menu does not re-render the whole list.
 */
import { create } from "zustand";
import { useCallback, useLayoutEffect, useRef } from "react";
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

/** Retain ownership through nested surfaces AND their final exit. Passing a
 * surface requires its onExited callback; without one, release on dismissal. */
export function useMenuHighlight(visible: boolean, key: SelectionKey | null, surface?: string) {
  const session = useRef({ visible, key, surface, release: null as (() => void) | null });
  useLayoutEffect(() => {
    const current = session.current;
    const opening = visible && !current.visible;
    current.visible = visible;
    if (visible && key) {
      current.surface = surface;
      if (opening || !current.release || current.key !== key) {
        const previous = current.release;
        current.release = useMenuHighlightStore.getState().claim(key);
        current.key = key;
        previous?.();
      }
    } else if (surface == null || key == null) {
      current.release?.();
      current.release = null;
    }
  }, [visible, key, surface]);
  useLayoutEffect(() => () => {
    session.current.release?.();
    session.current.release = null;
  }, []);
  return useCallback((exitedSurface: string) => {
    const current = session.current;
    if (current.visible || current.surface !== exitedSurface) return;
    current.release?.();
    current.release = null;
  }, []);
}
