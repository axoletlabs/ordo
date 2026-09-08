/**
 * Present/dismiss animation for overlays rendered through OverlayHost.
 * Keeps the tree mounted through the close animation, and owns Android back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard } from "react-native";
import { runOnJS, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { springs } from "../theme/tokens";

export function useOverlayPresence(visible: boolean, onDismiss: () => void) {
  const progress = useSharedValue(visible ? 1 : 0);
  const [rendered, setRendered] = useState(visible);
  const generation = useRef(0);

  const hide = useCallback((token: number) => {
    if (generation.current !== token) return;
    setRendered(false);
  }, []);

  useEffect(() => {
    if (visible) {
      generation.current += 1;
      Keyboard.dismiss();
      setRendered(true);
      progress.value = withSpring(1, springs.snappy);
      return;
    }
    if (!rendered) return;
    const token = generation.current;
    progress.value = withTiming(0, { duration: 140 }, (finished) => {
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
