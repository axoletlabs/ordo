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

const MODULE = Platform.OS === "android" ? NativeModules.OrdoSelectableText : null;
const emitter = MODULE ? new NativeEventEmitter(MODULE) : null;

export function useAndroidPhraseSelection(
  onRange: (start: number, end: number) => void,
): {
  textRef: RefObject<Text | null>;
  onLayout: () => void;
} {
  const textRef = useRef<Text | null>(null);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;
  const tagRef = useRef<number | null>(null);

  const onLayout = useCallback(() => {
    if (!MODULE) return;
    const tag = findNodeHandle(textRef.current);
    if (tag == null || tag === tagRef.current) return;
    if (tagRef.current != null) MODULE.detach(tagRef.current);
    tagRef.current = tag;
    MODULE.attach(tag);
  }, []);

  useEffect(() => {
    if (!emitter) return;
    const sub = emitter.addListener(
      "ordoSelectableText",
      (event: { target: number; start: number; end: number }) => {
        if (event.target !== tagRef.current) return;
        onRangeRef.current(event.start, event.end);
      },
    );
    return () => {
      sub.remove();
      if (tagRef.current != null) {
        MODULE?.detach(tagRef.current);
        tagRef.current = null;
      }
    };
  }, []);

  return { textRef, onLayout };
}
