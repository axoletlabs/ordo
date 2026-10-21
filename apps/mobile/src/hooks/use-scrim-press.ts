import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Platform, type GestureResponderEvent } from "react-native";
import { createScrimPressGuard } from "../lib/scrim-press";

/** Keep dismissal tied to a gesture that started on this opening's scrim. */
export function useScrimPress(active: boolean, onDismiss: () => void) {
  const guard = useRef(createScrimPressGuard()).current;
  const current = useRef({ active, onDismiss });
  useLayoutEffect(() => {
    current.current = { active, onDismiss };
  }, [active, onDismiss]);
  useLayoutEffect(() => { guard.reset(); }, [active, guard]);
  useLayoutEffect(() => () => { current.current.active = false; guard.reset(); }, [guard]);
  useEffect(() => {
    if (!active || Platform.OS !== "web") return;
    // Clear an unfinished drag's claim before the next gesture. Pointerup is
    // intentionally not a reset: touch browsers can deliver click later.
    document.addEventListener("pointerdown", guard.reset, true);
    return () => document.removeEventListener("pointerdown", guard.reset, true);
  }, [active, guard]);
  const onPress = useCallback((event: GestureResponderEvent) => {
    if (!current.current.active) return;
    if (guard.consume(Platform.OS === "web", event.nativeEvent)) current.current.onDismiss();
  }, [guard]);
  return { onPress, onPointerDown: guard.begin, onTouchStart: guard.begin, onPointerCancel: guard.reset };
}
