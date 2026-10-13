import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createSelectionState, type SelectionKey, type SelectionStore } from "../lib/selection-state";

export const SelectionStateContext = createContext<SelectionStore | null>(null);
const idle = createSelectionState();

/** Row updates bypass FlatList's asynchronous cell-refresh batch. */
export function useRowSelection(key: SelectionKey, fallback: { selected?: boolean; selectionMode?: boolean }) {
  const store = useContext(SelectionStateContext);
  const active = useStore(store ?? idle, state => state.active);
  const selected = useStore(store ?? idle, state => state.ids.has(key));
  return store ? { selected: active && selected, selectionMode: active } : fallback;
}
