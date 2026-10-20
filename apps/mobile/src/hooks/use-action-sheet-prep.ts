/**
 * Per-sheet "prepare to receive a handoff" flags.
 *
 * A context-menu handoff (Edit tags / Move to folder / Add tags) opens its
 * sheet as the source menu starts exiting the overlay host. The receiving
 * sheet used to mount inside a post-exit gap — render, layout,
 * measure — before its entrance could even start, which read as a dead pause
 * after the menu finished closing.
 *
 * Marking the target at the press itself lets mounting overlap the menu's
 * exit. Flags are sticky: a closed menu cannot un-prepare a sheet, and a
 * warm sheet that unmounted mid-handoff would just reintroduce the pause.
 *
 * A prepared surface is laid out but never interactive — FloatingPanel keeps
 * focus, Back, scrim, and pointer events gated on `visible` — so preparing
 * early has no overlay side effects.
 */
import { create } from "zustand";

export type ActionSheetTarget = "editTags" | "move" | "addTags";

type ActionSheetPrepStore = {
  prepped: Partial<Record<ActionSheetTarget, boolean>>;
  prep: (target: ActionSheetTarget) => void;
};

export const useActionSheetPrepStore = create<ActionSheetPrepStore>((set) => ({
  prepped: {},
  prep: (target) => {
    if (useActionSheetPrepStore.getState().prepped[target]) return;
    set({ prepped: { ...useActionSheetPrepStore.getState().prepped, [target]: true } });
  },
}));

/** True once this sheet has been marked; never resets. */
export const selectActionSheetPrep =
  (target: ActionSheetTarget) => (state: ActionSheetPrepStore): boolean => !!state.prepped[target];

export function useActionSheetPrep(target: ActionSheetTarget): boolean {
  return useActionSheetPrepStore(selectActionSheetPrep(target));
}

/** Subscribe-free mark for press handlers. */
export function prepActionSheets(target: ActionSheetTarget): void {
  useActionSheetPrepStore.getState().prep(target);
}
