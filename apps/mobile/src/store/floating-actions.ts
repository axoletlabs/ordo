/** Only focused, mounted FABs need snackbar clearance. */
import { create } from "zustand";

export const useFloatingActions = create<{ ids: readonly string[]; add: (id: string) => void; remove: (id: string) => void }>((set) => ({
  ids: [],
  add: (id) => set((state) => state.ids.includes(id) ? state : { ids: [...state.ids, id] }),
  remove: (id) => set((state) => ({ ids: state.ids.filter((item) => item !== id) })),
}));
