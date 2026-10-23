import { Keyboard, Platform } from "react-native";

type FocusTarget = { focus(): void; blur(): void; isFocused?(): boolean };

/** For an explicit, owner-checked focus request. Android Back can hide the IME
 * without clearing TextInputState; ref.focus() then silently does nothing.
 * Reset only that same field, never another surface's input or the global IME. */
export function focusTextInput(target: FocusTarget | null | undefined) {
  if (!target) return;
  let reopen = false;
  try {
    reopen = Platform.OS === "android" && target.isFocused?.() === true && Keyboard.isVisible?.() === false;
  } catch {
    // Missing keyboard APIs are not evidence that the keyboard is hidden.
  }
  if (reopen) target.blur();
  target.focus();
}
