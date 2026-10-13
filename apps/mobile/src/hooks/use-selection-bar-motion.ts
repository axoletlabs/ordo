import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Animated, Easing, Platform } from "react-native";
import { selectionActionLayout } from "../lib/selection-action-layout";
import { materialMotion, useMaterialMotion } from "../theme/material-motion";

export const SELECTION_DEPARTURE_MS = 90;
export type SelectionPillMotion = { width: Animated.Value; right: Animated.Value };
const nativeDriver = Platform.OS !== "web";

/** The resize graph runs in Android's NativeAnimatedNodesManager, not in
 * Reanimated's per-frame Fabric commits. JS only retargets and handles completion.
 * No listeners, frame callbacks, or synchronous UI-runtime reads are needed. */
export function useSelectionBarMotion(keys: readonly string[], available: number, pressedKey: string | null) {
  const motion = useMaterialMotion();
  const activePress = keys.includes(pressedKey ?? "") ? pressedKey : null;
  const target = selectionActionLayout(keys, available, activePress, !motion.reducedMotion);
  const key = JSON.stringify(keys);
  const latest = useRef({ key, keys, target, version: 0 });
  if (latest.current.key !== key) latest.current.version++;
  latest.current = { key, keys, target, version: latest.current.version };
  const [retainedKeys, setRetainedKeys] = useState<readonly string[]>(keys);
  const [shown, setShown] = useState(keys.length > 0);
  const [geometryReady, setGeometryReady] = useState(true);
  const settledKey = useRef(key);
  const values = useRef(new Map<string, SelectionPillMotion>());
  for (const actionKey of keys) {
    if (!values.current.has(actionKey)) values.current.set(actionKey, {
      width: new Animated.Value(target[actionKey]!.width),
      right: new Animated.Value(target[actionKey]!.right),
    });
  }
  const containerOpacity = useRef(new Animated.Value(0)).current;
  const containerShift = useRef(new Animated.Value(12)).current;
  const departureOpacity = useRef(new Animated.Value(1)).current;
  const previousKeys = useRef<readonly string[]>(keys);
  const previousTarget = useRef(target);
  const resize = useRef<Animated.CompositeAnimation | null>(null);
  const resizeGeneration = useRef(0);
  const moving = useRef(new Set<string>());
  const fading = useRef(false);

  useLayoutEffect(() => {
    const generation = ++resizeGeneration.current;
    resize.current?.stop();
    const current = latest.current;
    const departing = previousKeys.current.some(actionKey => !current.keys.includes(actionKey));
    const reopening = current.keys.length > 0 && previousKeys.current.length === 0;
    previousKeys.current = current.keys;
    if (!current.keys.length) return;
    setRetainedKeys(previous => [...current.keys, ...previous.filter(actionKey => !current.keys.includes(actionKey))]);
    const finish = () => {
      if (generation !== resizeGeneration.current) return;
      settledKey.current = latest.current.key;
      setGeometryReady(true);
      setRetainedKeys(latest.current.keys);
      moving.current.clear();
      fading.current = false;
    };
    const animations: Animated.CompositeAnimation[] = [];
    const nextMoving = new Set<string>();
    for (const actionKey of current.keys) {
      const pill = values.current.get(actionKey)!;
      const next = current.target[actionKey]!;
      for (const property of ["width", "right"] as const) {
        if (motion.reducedMotion || reopening) {
          pill[property].stopAnimation();
          pill[property].setValue(next[property]);
        } else if (previousTarget.current[actionKey]?.[property] !== next[property] || moving.current.has(`${actionKey}:${property}`)) {
          nextMoving.add(`${actionKey}:${property}`);
          animations.push(Animated.spring(pill[property], { toValue: next[property], ...motion.spatial,
            overshootClamping: true, useNativeDriver: nativeDriver, isInteraction: false }));
        }
      }
    }
    previousTarget.current = current.target;
    moving.current = nextMoving;
    if (motion.reducedMotion || reopening) {
      departureOpacity.setValue(0);
      finish();
      return;
    }
    setGeometryReady(false);
    const waitForDeparture = departing || fading.current;
    if (departing && !fading.current) departureOpacity.setValue(1);
    fading.current = waitForDeparture;
    // Completion, not a timeout, hands the faded space to Delete. Unlike the
    // old object spring, unchanged (including hidden) coordinates do no work.
    const fadeAnimation = Animated.timing(departureOpacity, { toValue: 0, duration: SELECTION_DEPARTURE_MS,
      easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver, isInteraction: false });
    const fade: Animated.CompositeAnimation = { ...fadeAnimation, start(callback) {
      fadeAnimation.start(result => {
        if (result.finished && generation === resizeGeneration.current) fading.current = false;
        callback?.(result);
      });
    } };
    const animation = waitForDeparture ? Animated.sequence([
      fade,
      Animated.parallel(animations),
    ]) : Animated.parallel(animations);
    resize.current = animation;
    animation.start(({ finished }) => { if (finished) finish(); });
  }, [key, activePress, available, motion.spatial, motion.reducedMotion, departureOpacity]);

  const visible = keys.length > 0;
  useLayoutEffect(() => {
    const version = latest.current.version;
    if (visible) setShown(true);
    const finish = ({ finished }: { finished: boolean }) => {
      if (!finished || visible || version !== latest.current.version || latest.current.keys.length) return;
      setShown(false);
      setRetainedKeys([]);
    };
    if (motion.reducedMotion) {
      containerOpacity.stopAnimation(); containerShift.stopAnimation();
      containerOpacity.setValue(visible ? 1 : 0); containerShift.setValue(visible ? 0 : 12);
      finish({ finished: true });
      return;
    }
    const animation = Animated.parallel([
      Animated.spring(containerOpacity, { toValue: visible ? 1 : 0, ...materialMotion.effects.fast,
        useNativeDriver: nativeDriver, isInteraction: false }),
      Animated.spring(containerShift, { toValue: visible ? 0 : 12, ...motion.spatial,
        useNativeDriver: nativeDriver, isInteraction: false }),
    ]);
    animation.start(finish);
    return () => animation.stop();
  }, [visible, motion.reducedMotion, motion.spatial, containerOpacity, containerShift]);

  useLayoutEffect(() => () => {
    resizeGeneration.current++;
    resize.current?.stop();
  }, []);
  const getTarget = useCallback((actionKey: string) => latest.current.target[actionKey], []);
  // New children render before layout effects run. Never give them the prior
  // transition's `true` readiness for that first commit.
  return { shown, retainedKeys, values: values.current, geometryReady: geometryReady && settledKey.current === key, departureOpacity,
    containerOpacity, containerShift, getTarget };
}
