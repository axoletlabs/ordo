/**
 * Drag-to-select starts on the leading selection mark — the same control
 * that long-presses into multi-select. A finger on the row body scrolls
 * the list. Once the mark's pan is active, the range follows the pointer
 * and the list auto-scrolls at the edges.
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  Platform,
  View,
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  PanGestureHandler,
  type PanGestureHandlerProps,
} from "react-native-gesture-handler";
import { haptics } from "../../lib/haptics";
import {
  autoScrollStep,
  indexForDrag,
  keysAfterDrag,
  sameSelection,
  type SelectionDragMode,
  type SelectionRowFrame,
} from "../../lib/selection-drag";
import { SELECTION_LONG_PRESS_MS, type SelectionKey } from "../../hooks/use-selection";

/** Native activation distance. Smaller than Android's scroll touch-slop so the mark wins first. */
const MARK_ACTIVATE_PX = 4;

type Measurable = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

type HandleRef = React.Component<PanGestureHandlerProps>;

type DragContextValue = {
  register: (key: string, node: Measurable | null) => void;
  registerHandle: (ref: React.RefObject<HandleRef | null>) => void;
  unregisterHandle: (ref: React.RefObject<HandleRef | null>) => void;
  consumePress: () => boolean;
  beginFromKey: (key: string, y: number) => void;
  moveTo: (y: number) => void;
  end: () => void;
};

const SelectionDragContext = React.createContext<DragContextValue | null>(null);

type DragSession = {
  anchorKey: string;
  mode: SelectionDragMode;
  baseline: ReadonlySet<string>;
  applied: Set<string>;
  pointerY: number;
  lastIndex: number;
};

export function useSelectionDragRow(key: string | null) {
  const ctx = useContext(SelectionDragContext);
  const keyRef = useRef(key);
  keyRef.current = key;
  const nodeRef = useRef<Measurable | null>(null);

  const bind = useCallback(
    (node: Measurable | null) => {
      nodeRef.current = node;
      const current = keyRef.current;
      if (!ctx || !current) return;
      ctx.register(current, node);
    },
    [ctx],
  );

  useEffect(() => {
    if (!ctx || !key) return;
    if (nodeRef.current) ctx.register(key, nodeRef.current);
    return () => ctx.register(key, null);
  }, [ctx, key]);

  const consumePress = useCallback(() => ctx?.consumePress() ?? false, [ctx]);

  return { bind, consumePress };
}

/**
 * Pan on the leading icon. Before multi-select it activates on the same
 * long-press that enters selection, then keeps that finger as the drag.
 * After that, a short move on the icon starts the drag immediately.
 */
export function SelectionDragHandle({
  selectionKey,
  selectionMode,
  onEnter,
  style,
  children,
}: {
  selectionKey: string;
  selectionMode: boolean;
  onEnter?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const ctx = useContext(SelectionDragContext);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const keyRef = useRef(selectionKey);
  keyRef.current = selectionKey;
  const modeRef = useRef(selectionMode);
  modeRef.current = selectionMode;
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const fingerDown = useRef(false);
  // Stay on the long-press config until the entering finger lifts, so the
  // handler that just activated is not reconfigured mid-gesture.
  const [armed, setArmed] = React.useState(selectionMode);

  useEffect(() => {
    if (!fingerDown.current) setArmed(selectionMode);
  }, [selectionMode]);

  const handleRef = useRef<HandleRef>(null);

  useEffect(() => {
    const current = ctxRef.current;
    if (!current) return;
    current.registerHandle(handleRef);
    return () => current.unregisterHandle(handleRef);
  }, [ctx]);

  const finish = useCallback(() => {
    fingerDown.current = false;
    setArmed(modeRef.current);
    ctxRef.current?.end();
  }, []);

  return (
    <PanGestureHandler
      ref={handleRef}
      enabled
      activateAfterLongPress={armed ? 0 : SELECTION_LONG_PRESS_MS}
      activeOffsetY={armed ? [-MARK_ACTIVATE_PX, MARK_ACTIVATE_PX] : [-10000, 10000]}
      shouldCancelWhenOutside={false}
      onActivated={(event) => {
        fingerDown.current = true;
        const y = (event.nativeEvent as unknown as { absoluteY: number }).absoluteY;
        if (!modeRef.current) onEnterRef.current?.();
        ctxRef.current?.beginFromKey(keyRef.current, y);
      }}
      onGestureEvent={(event) => {
        ctxRef.current?.moveTo(event.nativeEvent.absoluteY);
      }}
      onEnded={finish}
      onCancelled={finish}
      onFailed={finish}
    >
      <View style={[style, handleStyle]} collapsable={false}>
        {children}
      </View>
    </PanGestureHandler>
  );
}

export function useSelectionDrag({
  enabled,
  keys,
  selected,
  onSelectedChange,
}: {
  enabled: boolean;
  keys: readonly SelectionKey[];
  selected: ReadonlySet<SelectionKey>;
  onSelectedChange: (keys: SelectionKey[]) => void;
}) {
  const listRef = useRef<FlatList<any>>(null);
  const hostRef = useRef<View>(null);
  const frames = useRef(new Map<string, SelectionRowFrame>());
  const nodes = useRef(new Map<string, Measurable>());
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onChangeRef = useRef(onSelectedChange);
  onChangeRef.current = onSelectedChange;

  const handles = useRef(new Set<React.RefObject<HandleRef | null>>());
  const [scrollWaitFor, setScrollWaitFor] = React.useState<React.RefObject<HandleRef | null>[]>([]);
  const dragRef = useRef<DragSession | null>(null);
  const suppressRef = useRef(false);
  const offsetRef = useRef(0);
  const maxOffsetRef = useRef(0);
  const viewportRef = useRef({ top: 0, bottom: 0, height: 0 });
  const contentHeightRef = useRef(0);
  const rafRef = useRef(0);
  const clearSuppressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Once a drag is moving, keep the frames that onScroll shifts. A late
  // measureInWindow from before the scroll would put the finger on the wrong row.
  const replaceFrames = useRef(true);

  const placeFrame = useCallback((key: string, windowTop: number, height: number) => {
    if (!replaceFrames.current && frames.current.has(key)) return;
    frames.current.set(key, { top: windowTop, bottom: windowTop + height });
  }, []);

  const measureNode = useCallback((key: string, node: Measurable) => {
    node.measureInWindow?.((x, y, width, height) => {
      if (nodes.current.get(key) !== node || height <= 0 || width <= 0) return;
      placeFrame(key, y, height);
    });
  }, [placeFrame]);

  const register = useCallback(
    (key: string, node: Measurable | null) => {
      if (!node) {
        nodes.current.delete(key);
        frames.current.delete(key);
        return;
      }
      nodes.current.set(key, node);
      measureNode(key, node);
    },
    [measureNode],
  );

  const remeasureAll = useCallback((done: () => void) => {
    const entries = [...nodes.current.entries()];
    if (entries.length === 0) {
      done();
      return;
    }
    let left = entries.length;
    const finish = () => {
      left -= 1;
      if (left <= 0) done();
    };
    for (const [key, node] of entries) {
      if (!node.measureInWindow) {
        finish();
        continue;
      }
        node.measureInWindow((x, y, width, height) => {
          if (nodes.current.get(key) === node && height > 0 && width > 0) {
            placeFrame(key, y, height);
          }
          finish();
        });
    }
  }, [placeFrame]);

  const measureHost = useCallback((done?: () => void) => {
    const node = hostRef.current;
    if (!node?.measureInWindow) {
      done?.();
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      if (height > 0) {
        viewportRef.current = { top: y, bottom: y + height, height };
        maxOffsetRef.current = Math.max(0, contentHeightRef.current - height);
      }
      done?.();
    });
  }, []);

  const applyAt = useCallback((pointerY: number) => {
    // Window coordinates, shifted only by the scroll delta.
    const session = dragRef.current;
    if (!session) return;
    const hit = indexForDrag(keysRef.current, frames.current, pointerY);
    const index = hit ?? session.lastIndex;
    if (hit != null) session.lastIndex = hit;
    const next = keysAfterDrag(keysRef.current, session.baseline, session.anchorKey, index, session.mode);
    if (!next || sameSelection(session.applied, next)) return;
    session.applied = new Set(next);
    haptics.selection();
    onChangeRef.current(next as SelectionKey[]);
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const tick = useCallback(() => {
    const session = dragRef.current;
    if (!session) return;
    const { top, bottom } = viewportRef.current;
    const step = autoScrollStep(session.pointerY, top, bottom);
    if (step !== 0 && maxOffsetRef.current > 0) {
      const next = Math.min(maxOffsetRef.current, Math.max(0, offsetRef.current + step));
      if (next !== offsetRef.current) {
        listRef.current?.scrollToOffset({ offset: next, animated: false });
      }
    }
    applyAt(session.pointerY);
    rafRef.current = requestAnimationFrame(tick);
  }, [applyAt]);

  const detachPointer = useRef<(() => void) | null>(null);
  const waitFrame = useRef(0);
  const publishHandlesRef = useRef<() => void>(() => {});

  const endDrag = useCallback(() => {
    detachPointer.current?.();
    detachPointer.current = null;
    const hadSession = dragRef.current != null;
    dragRef.current = null;
    replaceFrames.current = true;
    stopLoop();
    publishHandlesRef.current();
    if (!hadSession) return;
    suppressRef.current = true;
    if (clearSuppressRef.current) clearTimeout(clearSuppressRef.current);
    clearSuppressRef.current = setTimeout(() => {
      suppressRef.current = false;
    }, 120);
  }, [stopLoop]);

  const beginFromKey = useCallback(
    (key: string, y: number) => {
      const anchorIndex = keysRef.current.indexOf(key as SelectionKey);
      if (anchorIndex < 0) return;
      detachPointer.current?.();
      detachPointer.current = null;
      const baseline = new Set(selectedRef.current);
      suppressRef.current = true;
      replaceFrames.current = true;
      dragRef.current = {
        anchorKey: key,
        mode: baseline.has(key as SelectionKey) ? "deselect" : "select",
        baseline,
        applied: new Set(baseline),
        pointerY: y,
        lastIndex: anchorIndex,
      };
      measureHost(() => {
        remeasureAll(() => {
          if (!dragRef.current) return;
          replaceFrames.current = false;
          applyAt(y);
          stopLoop();
          rafRef.current = requestAnimationFrame(tick);
        });
      });
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const move = (event: PointerEvent) => {
          const session = dragRef.current;
          if (!session) return;
          session.pointerY = event.clientY;
          applyAt(event.clientY);
        };
        const up = () => endDrag();
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        detachPointer.current = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
        };
      }
    },
    [applyAt, endDrag, measureHost, remeasureAll, stopLoop, tick],
  );

  const moveTo = useCallback(
    (y: number) => {
      const session = dragRef.current;
      if (!session) return;
      session.pointerY = y;
      applyAt(y);
    },
    [applyAt],
  );

  useEffect(
    () => () => {
      detachPointer.current?.();
      detachPointer.current = null;
      stopLoop();
      if (clearSuppressRef.current) clearTimeout(clearSuppressRef.current);
      if (waitFrame.current) cancelAnimationFrame(waitFrame.current);
    },
    [stopLoop],
  );

  useEffect(() => {
    if (!enabled) endDrag();
  }, [enabled, endDrag]);

  const publishHandles = useCallback(() => {
    if (dragRef.current) return;
    if (waitFrame.current) cancelAnimationFrame(waitFrame.current);
    waitFrame.current = requestAnimationFrame(() => {
      waitFrame.current = 0;
      if (dragRef.current) return;
      setScrollWaitFor([...handles.current]);
    });
  }, []);
  publishHandlesRef.current = publishHandles;

  const registerHandle = useCallback((ref: React.RefObject<HandleRef | null>) => {
    handles.current.add(ref);
    publishHandles();
  }, [publishHandles]);

  const unregisterHandle = useCallback((ref: React.RefObject<HandleRef | null>) => {
    handles.current.delete(ref);
    publishHandles();
  }, [publishHandles]);

  const context = useMemo<DragContextValue>(
    () => ({
      register,
      registerHandle,
      unregisterHandle,
      consumePress: () => suppressRef.current,
      beginFromKey,
      moveTo,
      end: endDrag,
    }),
    [beginFromKey, endDrag, moveTo, register, registerHandle, unregisterHandle],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y;
    const delta = next - offsetRef.current;
    offsetRef.current = next;
    if (delta === 0) return;
    for (const frame of frames.current.values()) {
      frame.top -= delta;
      frame.bottom -= delta;
    }
    const session = dragRef.current;
    if (session) applyAt(session.pointerY);
  }, [applyAt]);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = height;
    maxOffsetRef.current = Math.max(0, height - viewportRef.current.height);
  }, []);

  const onHostLayout = useCallback(() => {
    measureHost();
  }, [measureHost]);

  return {
    context,
    hostRef,
    onHostLayout,
    listRef,
    onScroll,
    onContentSizeChange,
    scrollEventThrottle: 16 as const,
    scrollWaitFor,
  };
}

export function SelectionDragFrame({
  drag,
  children,
}: {
  drag: ReturnType<typeof useSelectionDrag>;
  children: React.ReactNode;
}) {
  return (
    <SelectionDragContext.Provider value={drag.context}>
      <View
        ref={drag.hostRef}
        nativeID="selection-drag-host"
        style={{ flex: 1 }}
        collapsable={false}
        onLayout={drag.onHostLayout as (event: LayoutChangeEvent) => void}
      >
        {children}
      </View>
    </SelectionDragContext.Provider>
  );
}

const handleStyle = { touchAction: "none" } as ViewStyle;
