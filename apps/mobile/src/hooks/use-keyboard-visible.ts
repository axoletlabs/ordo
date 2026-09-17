import { useEffect, useState } from "react";
import { AppState, Keyboard, Platform, TextInput } from "react-native";

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
 * Blur the focused field and hide IME. Android keeps the keyboard up if a
 * TextInput unmounts while focused (overlay scrim tap, session-mode reset),
 * because Keyboard.dismiss() is a no-op once currentlyFocusedInput() is gone.
 */
export function dismissKeyboard() {
  try {
    Keyboard.dismiss();
  } catch {
    // Keyboard APIs can throw when the native module is missing (web shims).
  }
  try {
    const focused = TextInput.State.currentlyFocusedInput?.();
    if (focused) TextInput.State.blurTextInput(focused);
  } catch {
    // TextInput.State is not implemented on every platform shim.
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
