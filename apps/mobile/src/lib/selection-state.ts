import { createStore } from "zustand/vanilla";

export type SelectionKey = `bookmark:${string}` | `folder:${string}`;
export type SelectionState = { active: boolean; ids: ReadonlySet<SelectionKey>; revision: number };
export function createSelectionState() {
  return createStore<SelectionState>(() => ({ active: false, ids: new Set(), revision: 0 }));
}
export type SelectionStore = ReturnType<typeof createSelectionState>;
export function commitSelection(store: SelectionStore, ids: ReadonlySet<SelectionKey>, active: boolean) {
  store.setState({ ids, active, revision: store.getState().revision + 1 });
}
export function toggleSelection(store: SelectionStore, key: SelectionKey) {
  const ids = new Set(store.getState().ids);
  if (ids.has(key)) ids.delete(key);
  else ids.add(key);
  commitSelection(store, ids, true);
}
