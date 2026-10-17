import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Animated, Platform } from "react-native";
import { selectionActionLayout } from "../lib/selection-action-layout";
import { materialMotion, useMaterialMotion } from "../theme/material-motion";

export type SelectionPillMotion = { width: Animated.Value; right: Animated.Value };
const nativeDriver = Platform.OS !== "web";

/** Capability changes settle immediately. Only explicit button presses resize
 * the group; dragging across folder/bookmark boundaries must not repeatedly
 * choreograph a departure, a Delete expansion, and returning controls. */
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
  const values = useRef(new Map<string, SelectionPillMotion>());
  for (const actionKey of keys) {
    if (!values.current.has(actionKey)) values.current.set(actionKey, {
      width: new Animated.Value(target[actionKey]!.width),
      right: new Animated.Value(target[actionKey]!.right),
    });
  }
  const containerOpacity = useRef(new Animated.Value(0)).current;
  const containerShift = useRef(new Animated.Value(12)).current;
  const previousKeys = useRef<readonly string[]>(keys);
  const previousTarget = useRef(target);
  const previousWidth = useRef(available);
  const resize = useRef<Animated.CompositeAnimation | null>(null);
  const moving = useRef(new Set<string>());

  useLayoutEffect(() => {
    resize.current?.stop();
    const current = latest.current;
    const changedActions = JSON.stringify(previousKeys.current) !== current.key;
    const changedWidth = previousWidth.current !== available;
    previousKeys.current = current.keys;
    previousWidth.current = available;
    if (!current.keys.length) return;
    setRetainedKeys(current.keys);
    const animations: Animated.CompositeAnimation[] = [];
    const nextMoving = new Set<string>();
    for (const actionKey of current.keys) {
      const pill = values.current.get(actionKey)!;
      const next = current.target[actionKey]!;
      for (const property of ["width", "right"] as const) {
        if (motion.reducedMotion || changedActions || changedWidth) {
          pill[property].stopAnimation();
          pill[property].setValue(next[property]);
        } else if (previousTarget.current[actionKey]?.[property] !== next[property] || moving.current.has(`${actionKey}:${property}`)) {
          // A press interrupted by release or a motion-scheme change retargets
          // from its current native value, without waiting for completion.
          nextMoving.add(`${actionKey}:${property}`);
          animations.push(Animated.spring(pill[property], { toValue: next[property], ...motion.spatial,
            overshootClamping: true, useNativeDriver: nativeDriver, isInteraction: false }));
        }
      }
    }
    previousTarget.current = current.target;
    moving.current = nextMoving;
    const animation = Animated.parallel(animations);
    resize.current = animation;
    animation.start();
  }, [key, activePress, available, motion.spatial, motion.reducedMotion]);

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
    resize.current?.stop();
  }, []);
  const getTarget = useCallback((actionKey: string) => latest.current.target[actionKey], []);
  return { shown, retainedKeys, values: values.current,
    containerOpacity, containerShift, getTarget };
}
