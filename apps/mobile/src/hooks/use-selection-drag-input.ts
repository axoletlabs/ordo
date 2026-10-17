import { useCallback, useRef } from "react";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/** UI-thread mailbox: at most one move can be waiting on JavaScript. A busy
 * frame drops intermediate positions rather than replaying a finger's history. */
export function useSelectionDragInput(onMove: (token: number, y: number) => void) {
  const pointer = useSharedValue({ token: 0, y: 0, active: false });
  const pending = useSharedValue(false);
  const delivered = useSharedValue({ token: 0, y: 0 });
  const callback = useRef(onMove);
  callback.current = onMove;
  const deliver = useCallback((token: number, y: number) => {
    try { callback.current(token, y); }
    finally { pending.value = false; }
  }, [pending]);
  useFrameCallback(() => {
    const next = pointer.value;
    if (!next.active || pending.value || (delivered.value.token === next.token && delivered.value.y === next.y)) return;
    pending.value = true;
    delivered.value = { token: next.token, y: next.y };
    scheduleOnRN(deliver, next.token, next.y);
  });
  return pointer;
}
