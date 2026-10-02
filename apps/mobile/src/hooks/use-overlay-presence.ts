/**
 * Present/dismiss animation for overlays rendered through OverlayHost.
 * Keeps the tree mounted through the close animation, and owns Android back.
 * Spatial springs and non-overshooting effects are kept separate.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, BackHandler, Platform } from "react-native";
import { cancelAnimation, runOnJS, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useMaterialMotion } from "../theme/material-motion";
import { dismissKeyboard, keyboardIsOpen } from "./use-keyboard-visible";

const CLOSE_MS = 200;
const CLOSE_FALLBACK_MS = CLOSE_MS + 70;

export function useOverlayPresence(
  visible: boolean,
  onDismiss: () => void,
  options?: { dismissKeyboard?: boolean },
) {
  const progress = useSharedValue(visible ? 1 : 0);
  const spatial = useSharedValue(visible ? 1 : 0);
  const motion = useMaterialMotion();
  const [rendered, setRendered] = useState(visible);
  const generation = useRef(0);
  const wasVisible = useRef(false);
  const hideKeyboard = options?.dismissKeyboard !== false;

  const hide = useCallback((token: number) => {
    if (generation.current !== token) return;
    setRendered(false);
  }, []);

  useLayoutEffect(() => {
    if (visible) {
      const opening = !wasVisible.current;
      wasVisible.current = true;
      setRendered(true);
      if (opening) {
        generation.current += 1;
        if (hideKeyboard) dismissKeyboard();
        cancelAnimation(progress);
        cancelAnimation(spatial);
        progress.value = withTiming(1, { duration: motion.reducedMotion ? 0 : 200 });
        spatial.value = motion.reducedMotion ? 1 : withSpring(1, motion.spatial);
      }
      return;
    }
    wasVisible.current = false;
    if (!rendered) return;
    // Hide IME while the overlay tree is still mounted. Android leaves the
    // keyboard up if a focused TextInput is removed without a blur.
    if (hideKeyboard) dismissKeyboard();
    const token = generation.current;
    spatial.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
    progress.value = withTiming(0, { duration: motion.reducedMotion ? 0 : CLOSE_MS }, (finished) => {
      if (finished) runOnJS(hide)(token);
    });
    const fallback = setTimeout(() => hide(token), CLOSE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [hide, hideKeyboard, progress, spatial, rendered, visible, motion.spatial, motion.reducedMotion]);

  useEffect(() => {
    if (visible || !rendered) return;
    const token = generation.current;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") hide(token);
    });
    return () => sub.remove();
  }, [hide, rendered, visible]);

  useEffect(() => {
    if (!rendered || !visible || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (keyboardIsOpen()) {
        dismissKeyboard();
        return true;
      }
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [onDismiss, rendered, visible]);

  return { rendered, progress, spatial };
}
