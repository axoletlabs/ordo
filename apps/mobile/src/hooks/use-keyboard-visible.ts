import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

function readKeyboardVisible() {
  const metrics = Keyboard.metrics();
  return !!metrics && metrics.height > 0;
}

/**
 * Mirrors React Navigation's keyboard listener so chrome we wrap around the
 * tab bar can hide in lockstep with `tabBarHideOnKeyboard`.
 */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(readKeyboardVisible);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setVisible((event.endCoordinates?.height ?? 0) > 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
