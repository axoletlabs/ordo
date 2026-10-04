import { useCallback, useRef } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { exitSearchAfterKeyboardHide, handleSearchBack } from "../lib/search-back";

export function useSearchBack(active: boolean, exit: () => void, overlayActive: boolean) {
  const current = useRef({ active, exit, overlayActive });
  current.current = { active, exit, overlayActive };
  useFocusEffect(useCallback(() => {
    if (!active) return;
    const back = Platform.OS === "android" ? BackHandler.addEventListener("hardwareBackPress", () =>
      handleSearchBack(current.current.active, current.current.exit)) : null;
    const keyboard = Platform.OS === "android" ? Keyboard.addListener("keyboardDidHide", () => {
      const state = current.current;
      if (exitSearchAfterKeyboardHide(state.active, state.overlayActive)) state.exit();
    }) : null;
    return () => {
      back?.remove();
      keyboard?.remove();
      if (current.current.active) current.current.exit();
    };
  }, [active]));
}
