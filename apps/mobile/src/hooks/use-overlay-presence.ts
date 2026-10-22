/**
 * Present/dismiss animation for overlays rendered through OverlayHost.
 * Keeps the tree mounted through the close animation, and owns Android back.
 * Spatial springs and non-overshooting effects are kept separate.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, BackHandler, Platform } from "react-native";
import { cancelAnimation, Easing, runOnJS, useSharedValue, withSpring, withTiming, type WithTimingConfig } from "react-native-reanimated";
import { useMaterialMotion } from "../theme/material-motion";
import { dismissKeyboard, keyboardIsOpen } from "./use-keyboard-visible";

const CLOSE_MS = 200;
const CLOSE_FALLBACK_MS = CLOSE_MS + 70;

export function useOverlayPresence(
  visible: boolean,
  onDismiss: () => void,
  options?: {
    dismissKeyboard?: boolean;
    interactive?: boolean;
    ready?: boolean;
    /** Menus can reveal promptly without changing panel/scrim crossfades. */
    entranceEasing?: WithTimingConfig["easing"];
    /** Fired once when a rendered surface's exit actually completes. */
    onExited?: () => void;
    /** Fired once the moment a rendered surface starts exiting, while the
     * retained tree is still fading: a sibling handoff can begin now and
     * overlap its entrance with this surface's exit. */
    onExiting?: () => void;
  },
) {
  const progress = useSharedValue(0);
  const spatial = useSharedValue(0);
  const motion = useMaterialMotion();
  const [rendered, setRendered] = useState(visible);
  // A visible render already mounts the surface. Arm its later exit in that
  // same render pass instead of committing the new tree and immediately
  // scheduling another layout-effect commit just to retain it. React discards
  // this state update along with an abandoned concurrent opening.
  if (visible && !rendered) setRendered(true);
  const generation = useRef(0);
  const wasVisible = useRef(false);
  const wasOpen = useRef(false);
  /** True once an entrance actually started; a measurement-gated surface that
   * is closed before that has nothing to fade out. */
  const entered = useRef(false);
  const settled = useRef(-1);
  const mounted = useRef(true);
  const hideKeyboard = options?.dismissKeyboard !== false;
  const interactive = options?.interactive !== false;
  const ready = options?.ready !== false;
  const entranceEasing = options?.entranceEasing;
  const onExited = useRef(options?.onExited);
  const onExiting = useRef(options?.onExiting);
  const dismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    onExited.current = options?.onExited;
    onExiting.current = options?.onExiting;
    dismissRef.current = onDismiss;
  }, [options?.onExited, options?.onExiting, onDismiss]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const hide = useCallback((token: number) => {
    // The animation callback and the fallback timer can both land this call;
    // a reopen stales the token. Either way the exit notifies exactly once.
    if (!mounted.current || generation.current !== token || settled.current === token) return;
    settled.current = token;
    entered.current = false;
    // Unmount and release the handoff in the same batch. Firing onExited from
    // an effect after the unmount commit inserted a full render of the screen
    // behind the overlay between the fade finishing and the next surface
    // opening, which read as a close-then-delay on menu handoffs.
    setRendered(false);
    onExited.current?.();
  }, []);

  useLayoutEffect(() => {
    if (visible) {
      const freshOpen = !wasOpen.current;
      wasOpen.current = true;
      if (!ready) {
        // Measure/position an invisible surface before starting its entrance.
        // Otherwise a slow first layout consumes the fade while hidden and
        // reveals a fully opaque menu, or a stale frame from the previous open.
        // Once shown, a late readiness change (content swap, re-measure) must
        // not blank the surface: entering again from 0 is a visible flash and
        // a readiness value that never recovers would leave it stuck invisible
        // behind a blocking scrim.
        if (entered.current && !freshOpen) return;
        entered.current = false;
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
        entered.current = true;
        if (hideKeyboard) dismissKeyboard();
        cancelAnimation(progress);
        cancelAnimation(spatial);
        progress.value = motion.reducedMotion ? 1 : withTiming(1, { duration: 200, easing: entranceEasing ?? Easing.inOut(Easing.quad) });
        spatial.value = motion.reducedMotion ? 1 : withSpring(1, motion.spatial);
      }
      return;
    }
    wasVisible.current = false;
    const closing = wasOpen.current;
    wasOpen.current = false;
    if (!rendered) return;
    // Hide IME while the overlay tree is still mounted. Android leaves the
    // keyboard up if a focused TextInput is removed without a blur.
    if (hideKeyboard) dismissKeyboard();
    // Once per close: the retained tree is still mounted and fading, Back and
    // focus are already released, and the overlay host yields top position to
    // an active sibling — safe to hand off while this surface exits.
    if (closing) onExiting.current?.();
    const token = generation.current;
    // Reduced motion removes the surface synchronously. So does closing a
    // surface whose entrance never became visible: retaining it through a
    // 200ms fade only keeps an invisible, input-blocking layer around after a
    // fast open/close, and delays a sibling handoff for no visual benefit.
    if (motion.reducedMotion || !entered.current) {
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
  }, [hide, hideKeyboard, progress, spatial, rendered, visible, ready, entranceEasing, motion.spatial, motion.reducedMotion]);

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

  return {
    /** `true` while the committed surface is still mounted (including the
     * retained exit tree). Callers can reuse its measurements on a reopen. */
    retained: rendered,
    rendered: visible || rendered,
    progress,
    spatial,
  };
}
