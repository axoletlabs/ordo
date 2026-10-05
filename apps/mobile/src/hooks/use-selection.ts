/**
 * Multi-select for library rows. Press-and-hold the favicon or folder icon
 * enters the mode with that item selected; further taps toggle. Android back
 * exits without acting.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { create, useStore } from "zustand";
import { commitSelection, createSelectionState, toggleSelection, type SelectionKey } from "../lib/selection-state";
import { haptics } from "../lib/haptics";
import { dismissKeyboard } from "./use-keyboard-visible";
import { createSelectionHoldGuard } from "../lib/selection-hold-guard";

export type { SelectionKey } from "../lib/selection-state";

export function bookmarkKey(id: string): SelectionKey {
  return `bookmark:${id}`;
}

export function folderKey(id: string): SelectionKey {
  return `folder:${id}`;
}

export const SELECTION_LONG_PRESS_MS = 400;
export const SELECTION_BAR_HEIGHT = 64;

/** Survives the favicon/folder-icon host view swapping to a checkbox mid-hold. */
export function useSelectionHoldGuard() {
  return useRef(createSelectionHoldGuard()).current;
}

/** Layout chrome reads this so the tab bar can hide while a screen is selecting. */
export const useSelectionUiStore = create<{ active: boolean }>(() => ({ active: false }));

export function useSelectionMode() {
  const [store] = useState(createSelectionState);
  const { active, ids, revision } = useStore(store);

  const bump = useCallback((next: ReadonlySet<SelectionKey>, nextActive: boolean) => {
    commitSelection(store, next, nextActive);
  }, [store]);

  const enter = useCallback(
    (key?: SelectionKey) => {
      dismissKeyboard();
      haptics.medium();
      bump(key ? new Set([key]) : new Set(), true);
    },
    [bump],
  );

  const exit = useCallback(() => {
    bump(new Set(), false);
  }, [bump]);

  const toggle = useCallback((key: SelectionKey) => {
    haptics.selection();
    toggleSelection(store, key);
  }, [store]);

  const replace = useCallback(
    (keys: readonly SelectionKey[]) => {
      haptics.selection();
      const next = new Set(keys);
      bump(next, true);
    },
    [bump],
  );

  /** Drag-select writes the set without a haptic on every row. */
  const assign = useCallback(
    (keys: readonly SelectionKey[]) => {
      bump(new Set(keys), true);
    },
    [bump],
  );

  const activeRef = useRef(active);
  const focusedRef = useRef(false);
  activeRef.current = active;

  useEffect(() => {
    if (focusedRef.current) useSelectionUiStore.setState({ active });
  }, [active]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      useSelectionUiStore.setState({ active: activeRef.current });
      const subscription = Platform.OS === "android" ? BackHandler.addEventListener("hardwareBackPress", () => {
        if (!activeRef.current) return false;
        exit();
        return true;
      }) : null;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented && activeRef.current) exit();
      };
      if (Platform.OS === "web") document.addEventListener("keydown", onKey);
      return () => {
        focusedRef.current = false;
        subscription?.remove();
        if (Platform.OS === "web") document.removeEventListener("keydown", onKey);
        useSelectionUiStore.setState({ active: false });
      };
    }, [exit]),
  );

  return {
    store,
    active,
    ids,
    count: ids.size,
    revision,
    enter,
    exit,
    toggle,
    replace,
    assign,
    has: (key: SelectionKey) => ids.has(key),
  };
}
