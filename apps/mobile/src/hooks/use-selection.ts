/**
 * Multi-select for library rows. Long-press enters the mode with one item;
 * further taps toggle. Android back exits without acting.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "expo-router";
import { create } from "zustand";
import { haptics } from "../lib/haptics";

export type SelectionKey = `bookmark:${string}` | `folder:${string}`;

export function bookmarkKey(id: string): SelectionKey {
  return `bookmark:${id}`;
}

export function folderKey(id: string): SelectionKey {
  return `folder:${id}`;
}

export const SELECTION_LONG_PRESS_MS = 400;
export const SELECTION_BAR_HEIGHT = 64;

/** Layout chrome reads this so the tab bar can hide while a screen is selecting. */
export const useSelectionUiStore = create<{ active: boolean }>(() => ({ active: false }));

export function useSelectionMode() {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<ReadonlySet<SelectionKey>>(() => new Set());
  const [revision, setRevision] = useState(0);

  const bump = useCallback((next: ReadonlySet<SelectionKey>, nextActive: boolean) => {
    setIds(next);
    setActive(nextActive);
    setRevision((value) => value + 1);
  }, []);

  const enter = useCallback(
    (key: SelectionKey) => {
      haptics.medium();
      bump(new Set([key]), true);
    },
    [bump],
  );

  const exit = useCallback(() => {
    bump(new Set(), false);
  }, [bump]);

  const idsRef = useRef(ids);
  idsRef.current = ids;

  const toggle = useCallback((key: SelectionKey) => {
    haptics.selection();
    const next = new Set(idsRef.current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    bump(next, next.size > 0);
  }, [bump]);

  const replace = useCallback(
    (keys: readonly SelectionKey[]) => {
      haptics.selection();
      const next = new Set(keys);
      bump(next, next.size > 0);
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
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!activeRef.current) return false;
        exit();
        return true;
      });
      return () => {
        focusedRef.current = false;
        subscription.remove();
        useSelectionUiStore.setState({ active: false });
      };
    }, [exit]),
  );

  return {
    active,
    ids,
    count: ids.size,
    revision,
    enter,
    exit,
    toggle,
    replace,
    has: (key: SelectionKey) => ids.has(key),
  };
}
