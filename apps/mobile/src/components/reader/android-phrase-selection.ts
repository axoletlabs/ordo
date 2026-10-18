/**
 * Android article phrases are RN Text views. This module hides the insertion
 * caret and reports the selected range. No-op on iOS/web and before a native rebuild.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  findNodeHandle,
  type Text,
} from "react-native";
import { isMenuAnchorRect, type MenuAnchorRect } from "../../lib/menu-anchor";

const MODULE = Platform.OS === "android" ? NativeModules.OrdoSelectableText : null;
const emitter = MODULE ? new NativeEventEmitter(MODULE) : null;

interface SelectionEvent {
  target: number;
  start: number;
  end: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

// One native event subscription per reader, not one per paragraph. A selection
// should dispatch directly to its owner rather than visiting every article block.
const ranges = new Map<number, (event: SelectionEvent) => void>();
let subscription: ReturnType<NativeEventEmitter["addListener"]> | undefined;

function registerRange(tag: number, onRange: (event: SelectionEvent) => void) {
  ranges.set(tag, onRange);
  if (!subscription && emitter) subscription = emitter.addListener("ordoSelectableText", (event: SelectionEvent) => {
    ranges.get(event.target)?.(event);
  });
}

function unregisterRange(tag: number) {
  ranges.delete(tag);
  if (!ranges.size) { subscription?.remove(); subscription = undefined; }
}

export function useAndroidPhraseSelection(
  onRange: (start: number, end: number, rect?: MenuAnchorRect) => void,
): {
  textRef: RefObject<Text | null>;
  onLayout: () => void;
} {
  const textRef = useRef<Text | null>(null);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;
  const tagRef = useRef<number | null>(null);

  const attach = useCallback(() => {
    if (!MODULE) return;
    const tag = findNodeHandle(textRef.current);
    if (tag == null || tag === tagRef.current) return;
    if (tagRef.current != null) {
      unregisterRange(tagRef.current);
      MODULE.detach(tagRef.current);
    }
    tagRef.current = tag;
    registerRange(tag, (event) => {
      const rect = { x: event.x ?? 0, y: event.y ?? 0, width: event.width ?? 0, height: event.height ?? 0 };
      onRangeRef.current(event.start, event.end, isMenuAnchorRect(rect) ? rect : undefined);
    });
    MODULE.attach(tag);
  }, []);

  useEffect(() => {
    attach();
    return () => {
      if (tagRef.current != null) {
        unregisterRange(tagRef.current);
        MODULE?.detach(tagRef.current);
        tagRef.current = null;
      }
    };
  }, [attach]);

  return { textRef, onLayout: attach };
}
