/**
 * Present/dismiss animation for overlays rendered through OverlayHost.
 * Keeps the tree mounted through the close animation, and owns Android back.
 * Menus snap open so choosing a control is not waiting on a spring.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BackHandler, Keyboard } from "react-native";
import { cancelAnimation, runOnJS, useSharedValue, withTiming } from "react-native-reanimated";

export function useOverlayPresence(visible: boolean, onDismiss: () => void) {
  const progress = useSharedValue(visible ? 1 : 0);
  const [rendered, setRendered] = useState(visible);
  const generation = useRef(0);

  const hide = useCallback((token: number) => {
    if (generation.current !== token) return;
    setRendered(false);
  }, []);

  useLayoutEffect(() => {
    if (visible) {
      generation.current += 1;
      Keyboard.dismiss();
      setRendered(true);
      cancelAnimation(progress);
      progress.value = 1;
      return;
    }
    if (!rendered) return;
    const token = generation.current;
    progress.value = withTiming(0, { duration: 90 }, (finished) => {
      if (finished) runOnJS(hide)(token);
    });
  }, [hide, progress, rendered, visible]);

  useEffect(() => {
    if (!rendered) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [onDismiss, rendered]);

  return { rendered, progress };
}
