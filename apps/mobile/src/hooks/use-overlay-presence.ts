/**
 * Present/dismiss animation for overlays rendered through OverlayHost.
 * Keeps the tree mounted through the close animation, and owns Android back.
 * Menus snap open so choosing a control is not waiting on a spring.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, BackHandler, Keyboard } from "react-native";
import { cancelAnimation, runOnJS, useSharedValue, withTiming } from "react-native-reanimated";
import { keyboardIsOpen } from "./use-keyboard-visible";

const CLOSE_MS = 90;
const CLOSE_FALLBACK_MS = CLOSE_MS + 70;

export function useOverlayPresence(
  visible: boolean,
  onDismiss: () => void,
  options?: { dismissKeyboard?: boolean },
) {
  const progress = useSharedValue(visible ? 1 : 0);
  const [rendered, setRendered] = useState(visible);
  const generation = useRef(0);
  const dismissKeyboard = options?.dismissKeyboard !== false;

  const hide = useCallback((token: number) => {
    if (generation.current !== token) return;
    setRendered(false);
  }, []);

  useLayoutEffect(() => {
    if (visible) {
      generation.current += 1;
      if (dismissKeyboard) Keyboard.dismiss();
      setRendered(true);
      cancelAnimation(progress);
      progress.value = 1;
      return;
    }
    if (!rendered) return;
    const token = generation.current;
    progress.value = withTiming(0, { duration: CLOSE_MS }, (finished) => {
      if (finished) runOnJS(hide)(token);
    });
    const fallback = setTimeout(() => hide(token), CLOSE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [dismissKeyboard, hide, progress, rendered, visible]);

  useEffect(() => {
    if (visible || !rendered) return;
    const token = generation.current;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") hide(token);
    });
    return () => sub.remove();
  }, [hide, rendered, visible]);

  useEffect(() => {
    if (!rendered || !visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (keyboardIsOpen()) {
        Keyboard.dismiss();
        return true;
      }
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [onDismiss, rendered, visible]);

  return { rendered, progress };
}
