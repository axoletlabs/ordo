/**
 * Present/dismiss animation for overlays rendered through OverlayHost.
 * Keeps the tree mounted through the close animation, and owns Android back.
 * Spatial springs and non-overshooting effects are kept separate.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, BackHandler, Platform } from "react-native";
import { cancelAnimation, Easing, runOnJS, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useMaterialMotion } from "../theme/material-motion";
import { dismissKeyboard, keyboardIsOpen } from "./use-keyboard-visible";

const CLOSE_MS = 200;
const CLOSE_FALLBACK_MS = CLOSE_MS + 70;

export function useOverlayPresence(
  visible: boolean,
  onDismiss: () => void,
  options?: { dismissKeyboard?: boolean; interactive?: boolean; ready?: boolean; onExited?: () => void },
) {
  const progress = useSharedValue(0);
  const spatial = useSharedValue(0);
  const motion = useMaterialMotion();
  const [rendered, setRendered] = useState(visible);
  const generation = useRef(0);
  const wasVisible = useRef(false);
  const hideKeyboard = options?.dismissKeyboard !== false;
  const interactive = options?.interactive !== false;
  const ready = options?.ready !== false;
  const onExited = useRef(options?.onExited);
  onExited.current = options?.onExited;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const hadSurface = useRef(visible);
  useEffect(() => {
    if (visible) hadSurface.current = true;
    if (visible || rendered || !hadSurface.current) return;
    hadSurface.current = false;
    onExited.current?.();
  }, [visible, rendered]);

  const hide = useCallback((token: number) => {
    if (generation.current !== token) return;
    setRendered(false);
  }, []);

  useLayoutEffect(() => {
    if (visible) {
      setRendered(true);
      if (!ready) {
        // Measure/position an invisible surface before starting its entrance.
        // Otherwise a slow first layout consumes the fade while hidden and
        // reveals a fully opaque menu, or a stale frame from the previous open.
        generation.current += 1;
        wasVisible.current = false;
        cancelAnimation(progress);
        cancelAnimation(spatial);
        progress.value = 0;
        spatial.value = 0;
        return;
      }
      const opening = !wasVisible.current;
      wasVisible.current = true;
      if (opening) {
        generation.current += 1;
        if (hideKeyboard) dismissKeyboard();
        cancelAnimation(progress);
        cancelAnimation(spatial);
        progress.value = motion.reducedMotion ? 1 : withTiming(1, { duration: 200, easing: Easing.inOut(Easing.quad) });
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
    if (motion.reducedMotion) {
      cancelAnimation(progress);
      cancelAnimation(spatial);
      progress.value = 0;
      spatial.value = 0;
      hide(token);
      return;
    }
    spatial.value = withSpring(0, motion.spatial);
    progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.inOut(Easing.quad) }, (finished) => {
      if (finished) runOnJS(hide)(token);
    });
    const fallback = setTimeout(() => hide(token), CLOSE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [hide, hideKeyboard, progress, spatial, rendered, visible, ready, motion.spatial, motion.reducedMotion]);

  useLayoutEffect(() => {
    if (!visible || !ready || !motion.reducedMotion) return;
    // The accessibility preference can change during an open transition.
    cancelAnimation(progress);
    cancelAnimation(spatial);
    progress.value = 1;
    spatial.value = 1;
  }, [visible, ready, motion.reducedMotion, progress, spatial]);

  useEffect(() => {
    if (visible || !rendered) return;
    const token = generation.current;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") hide(token);
    });
    return () => sub.remove();
  }, [hide, rendered, visible]);

  useEffect(() => {
    if (!rendered || !visible || !interactive || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (keyboardIsOpen()) {
        dismissKeyboard();
        return true;
      }
      dismissRef.current();
      return true;
    });
    return () => sub.remove();
  }, [rendered, visible, interactive]);

  return { rendered: visible || rendered, progress, spatial };
}
