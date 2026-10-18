import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useAppForeground } from "./use-animation-activity";

/** UI-thread mailbox: at most one move can be waiting on JavaScript. A busy
 * frame drops intermediate positions rather than replaying a finger's history. */
export function useSelectionDragInput(onMove: (token: number, y: number) => void, enabled = true) {
  const active = useAppForeground() && enabled && Platform.OS !== "web";
  const pointer = useSharedValue({ token: 0, y: 0, active: false });
  const pending = useSharedValue(false);
  const delivered = useSharedValue({ token: 0, y: 0 });
  const callback = useRef(onMove);
  callback.current = onMove;
  const deliver = useCallback((token: number, y: number) => {
    try { callback.current(token, y); }
    finally { pending.value = false; }
  }, [pending]);
  const frame = useFrameCallback(() => {
    const next = pointer.value;
    if (!next.active || pending.value || (delivered.value.token === next.token && delivered.value.y === next.y)) return;
    pending.value = true;
    delivered.value = { token: next.token, y: next.y };
    scheduleOnRN(deliver, next.token, next.y);
  }, false);
  useEffect(() => {
    frame.setActive(active);
    return () => frame.setActive(false);
  }, [frame, active]);
  return pointer;
}
