import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { shouldAbandonShareIntake } from "../lib/share-intake";

interface IncomingShareState {
  pendingUrl: string | null;
  /** Bumped when the intake is cancelled so in-flight handlers cannot reopen it. */
  generation: number;
  setPendingUrl: (url: string) => void;
  clear: () => void;
}

export const useIncomingShareStore = create<IncomingShareState>((set) => ({
  pendingUrl: null,
  generation: 0,
  setPendingUrl: (pendingUrl) => set({ pendingUrl }),
  clear: () => set((state) => ({ pendingUrl: null, generation: state.generation + 1 })),
}));

let lastAppState = AppState.currentState;
AppState.addEventListener("change", (state) => {
  const wasActive = lastAppState === "active";
  lastAppState = state;
  if (Platform.OS === "android" && shouldAbandonShareIntake(wasActive, state)) {
    useIncomingShareStore.getState().clear();
  }
});
