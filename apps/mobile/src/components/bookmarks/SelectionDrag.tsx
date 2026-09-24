/**
 * Drag across rows in multi-select to extend a range. A fast flick still
 * scrolls; a slower vertical drag claims the gesture and auto-scrolls when
 * the pointer sits in the top or bottom band of the list.
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  Platform,
  View,
  type FlatList,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type View as ViewType,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { haptics } from "../../lib/haptics";
import {
  autoScrollStep,
  indexAtPoint,
  keysAfterDrag,
  sameSelection,
  shouldClaimSelectionDrag,
  type SelectionDragMode,
  type SelectionRowFrame,
} from "../../lib/selection-drag";
import type { SelectionKey } from "../../hooks/use-selection";

type Measurable = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

type DragContextValue = {
  register: (key: string, node: Measurable | null) => void;
  consumePress: () => boolean;
};

const SelectionDragContext = React.createContext<DragContextValue | null>(null);

type DragSession = {
  anchorKey: string;
  mode: SelectionDragMode;
  baseline: ReadonlySet<string>;
  applied: Set<string>;
  pointerY: number;
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
  // `any` so one drag host can scroll bookmark and mixed library lists.
  const listRef = useRef<FlatList<any>>(null);
  const hostRef = useRef<ViewType>(null);
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

  const dragRef = useRef<DragSession | null>(null);
  const suppressRef = useRef(false);
  const originRef = useRef<{ x: number; y: number; t: number; rejected: boolean } | null>(null);
  const offsetRef = useRef(0);
  const maxOffsetRef = useRef(0);
  const viewportRef = useRef({ top: 0, bottom: 0, height: 0 });
  const contentHeightRef = useRef(0);
  const rafRef = useRef(0);
  const clearSuppressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const measureNode = useCallback((key: string, node: Measurable) => {
    node.measureInWindow?.((x, y, width, height) => {
      if (nodes.current.get(key) !== node || height <= 0 || width <= 0) return;
      frames.current.set(key, { top: y, bottom: y + height });
    });
  }, []);

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

  const remeasureAll = useCallback(
    (done: () => void) => {
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
            frames.current.set(key, { top: y, bottom: y + height });
          }
          finish();
        });
      }
    },
    [],
  );

  const measureHost = useCallback((done?: () => void) => {
    hostRef.current?.measureInWindow?.((x, y, width, height) => {
      if (height > 0) {
        viewportRef.current = { top: y, bottom: y + height, height };
        maxOffsetRef.current = Math.max(0, contentHeightRef.current - height);
      }
      done?.();
    });
  }, []);

  const applyAt = useCallback((pointerY: number) => {
    const session = dragRef.current;
    if (!session) return;
    const index = indexAtPoint(keysRef.current, frames.current, pointerY);
    if (index == null) return;
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
        offsetRef.current = next;
        listRef.current?.scrollToOffset({ offset: next, animated: false });
      }
    }
    remeasureAll(() => {
      if (!dragRef.current) return;
      applyAt(dragRef.current.pointerY);
      rafRef.current = requestAnimationFrame(tick);
    });
  }, [applyAt, remeasureAll]);

  const beginAt = useCallback(
    (y: number) => {
      const index = indexAtPoint(keysRef.current, frames.current, y);
      const anchorKey = index == null ? null : keysRef.current[index];
      if (!anchorKey) return false;
      const baseline = new Set(selectedRef.current);
      suppressRef.current = true;
      dragRef.current = {
        anchorKey,
        mode: baseline.has(anchorKey) ? "deselect" : "select",
        baseline,
        applied: new Set(baseline),
        pointerY: y,
      };
      measureHost(() => {
        applyAt(y);
        stopLoop();
        rafRef.current = requestAnimationFrame(tick);
      });
      return true;
    },
    [applyAt, measureHost, stopLoop, tick],
  );

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    stopLoop();
    if (clearSuppressRef.current) clearTimeout(clearSuppressRef.current);
    clearSuppressRef.current = setTimeout(() => {
      suppressRef.current = false;
    }, 80);
  }, [stopLoop]);

  useEffect(() => () => {
    stopLoop();
    if (clearSuppressRef.current) clearTimeout(clearSuppressRef.current);
  }, [stopLoop]);

  useEffect(() => {
    if (!enabled) endDrag();
  }, [enabled, endDrag]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const current = hostRef.current as unknown as HTMLElement | null;
    const node =
      current && typeof current.addEventListener === "function"
        ? current
        : typeof document !== "undefined"
          ? document.getElementById("selection-drag-host")
          : null;
    if (!node) return;
    const previousUserSelect = node.style.userSelect;
    node.style.userSelect = enabled ? "none" : previousUserSelect;

    const onDown = (event: PointerEvent) => {
      if (!enabledRef.current || event.button !== 0) return;
      originRef.current = { x: event.clientX, y: event.clientY, t: Date.now(), rejected: false };
      remeasureAll(() => {});
    };
    const onMove = (event: PointerEvent) => {
      const origin = originRef.current;
      if (!enabledRef.current || !origin || origin.rejected) return;
      if (dragRef.current) {
        dragRef.current.pointerY = event.clientY;
        applyAt(event.clientY);
        event.preventDefault();
        return;
      }
      const elapsed = Date.now() - origin.t;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (!shouldClaimSelectionDrag(dx, dy, elapsed)) {
        if (Math.abs(dy) >= 12 && Math.abs(dy) / Math.max(elapsed, 1) > 1.05) origin.rejected = true;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= 12) origin.rejected = true;
        return;
      }
      if (!beginAt(event.clientY)) return;
      event.preventDefault();
    };
    const onUp = () => {
      originRef.current = null;
      endDrag();
    };

    node.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      node.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      node.style.userSelect = previousUserSelect;
    };
  }, [applyAt, beginAt, enabled, endDrag, remeasureAll]);

  const context = useMemo<DragContextValue>(
    () => ({
      register,
      consumePress: () => suppressRef.current,
    }),
    [register],
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
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = height;
    maxOffsetRef.current = Math.max(0, height - viewportRef.current.height);
  }, []);

  const onHostLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      measureHost();
    },
    [measureHost],
  );

  const beginAtRef = useRef(beginAt);
  beginAtRef.current = beginAt;
  const applyAtRef = useRef(applyAt);
  applyAtRef.current = applyAt;
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;

  const scrollWaitFor = useMemo(() => {
    let origin: { x: number; y: number; t: number } | null = null;
    return Gesture.Pan()
      .runOnJS(true)
      .manualActivation(true)
      .onTouchesDown((event, manager) => {
        if (!enabledRef.current) {
          manager.fail();
          return;
        }
        const touch = event.allTouches[0];
        if (!touch) {
          manager.fail();
          return;
        }
        origin = { x: touch.absoluteX, y: touch.absoluteY, t: Date.now() };
        remeasureAll(() => {});
      })
      .onTouchesMove((event, manager) => {
        if (!enabledRef.current || !origin) {
          manager.fail();
          return;
        }
        const touch = event.changedTouches[0] ?? event.allTouches[0];
        if (!touch) return;
        const dx = touch.absoluteX - origin.x;
        const dy = touch.absoluteY - origin.y;
        const elapsed = Date.now() - origin.t;
        if (!shouldClaimSelectionDrag(dx, dy, elapsed)) {
          if (Math.abs(dy) >= 12 && Math.abs(dy) / Math.max(elapsed, 1) > 1.05) manager.fail();
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= 12) manager.fail();
          return;
        }
        if (!beginAtRef.current(touch.absoluteY)) {
          manager.fail();
          return;
        }
        manager.activate();
      })
      .onTouchesUp((_event, manager) => {
        origin = null;
        if (!dragRef.current) manager.fail();
      })
      .onUpdate((event) => {
        const session = dragRef.current;
        if (!session) return;
        session.pointerY = event.absoluteY;
        applyAtRef.current(event.absoluteY);
      })
      .onFinalize(() => {
        origin = null;
        endDragRef.current();
      });
  }, [remeasureAll]);

  const panHandlers = useMemo(
    () => ({
      onTouchStart: (event: GestureResponderEvent) => {
        originRef.current = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          t: Date.now(),
          rejected: false,
        };
      },
      onTouchEnd: () => {
        if (!dragRef.current) originRef.current = null;
      },
      onTouchCancel: () => {
        if (!dragRef.current) originRef.current = null;
      },
      onMoveShouldSetResponderCapture: (event: GestureResponderEvent) => {
        if (Platform.OS === "web" || !enabledRef.current) return false;
        if (dragRef.current) return true;
        const y = event.nativeEvent.pageY;
        const x = event.nativeEvent.pageX;
        if (!originRef.current) {
          originRef.current = { x, y, t: Date.now(), rejected: false };
          return false;
        }
        if (originRef.current.rejected) return false;
        const elapsed = Date.now() - originRef.current.t;
        const dx = x - originRef.current.x;
        const dy = y - originRef.current.y;
        if (!shouldClaimSelectionDrag(dx, dy, elapsed)) {
          if (Math.abs(dy) >= 12 && Math.abs(dy) / Math.max(elapsed, 1) > 1.05) {
            originRef.current.rejected = true;
          }
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= 12) {
            originRef.current.rejected = true;
          }
          return false;
        }
        if (!beginAt(y)) {
          originRef.current.rejected = true;
          return false;
        }
        return true;
      },
      onResponderMove: (event: GestureResponderEvent) => {
        const session = dragRef.current;
        if (!session) return;
        session.pointerY = event.nativeEvent.pageY;
        applyAt(session.pointerY);
      },
      onResponderRelease: () => {
        originRef.current = null;
        endDrag();
      },
      onResponderTerminate: () => {
        originRef.current = null;
        endDrag();
      },
      onResponderTerminationRequest: () => false,
    }),
    [beginAt, endDrag],
  );

  return {
    context,
    hostRef,
    panHandlers,
    onHostLayout,
    listRef,
    scrollWaitFor: Platform.OS === "web" ? undefined : scrollWaitFor,
    onScroll,
    onContentSizeChange,
    scrollEventThrottle: 16 as const,
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
        onLayout={drag.onHostLayout}
        {...drag.panHandlers}
      >
        {children}
      </View>
    </SelectionDragContext.Provider>
  );
}

