import { useEffect, useState } from "react";
import { AppState, Keyboard, Platform } from "react-native";

export function keyboardIsOpen() {
  try {
    if (typeof Keyboard.isVisible === "function" && Keyboard.isVisible()) return true;
    const metrics = typeof Keyboard.metrics === "function" ? Keyboard.metrics() : null;
    return !!metrics && metrics.height > 0;
  } catch {
    return false;
  }
}

/**
 * Mirrors React Navigation's keyboard listener so chrome we wrap around the
 * tab bar can hide in lockstep with `tabBarHideOnKeyboard`.
 */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => keyboardIsOpen());

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setVisible((event.endCoordinates?.height ?? 0) > 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") setVisible(keyboardIsOpen());
    });
    return () => {
      show.remove();
      hide.remove();
      app.remove();
    };
  }, []);

  return visible;
}
