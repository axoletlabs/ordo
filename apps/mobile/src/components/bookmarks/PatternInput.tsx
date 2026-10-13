/**
 * Android-style 3×3 pattern lock: draw through dots, connecting lines follow
 * the finger, and lifting completes the pattern.
 */
import React, { useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeTouchEvent,
} from "react-native";
import Svg, { Line } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { radius } from "../../theme/tokens";
import { PressableScale } from "../ui/PressableScale";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { appendPatternNode } from "../../lib/pattern-input";

const NODES = 9;
const COLS = 3;
const SIZE = 252;
const PADDING = 36;
const DOT = 18;
const HALO = 40;
const HIT_RADIUS = 34;
const LINE_WIDTH = 3;

function nodeCenter(index: number): { x: number; y: number } {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const span = SIZE - PADDING * 2;
  const step = span / (COLS - 1);
  return { x: PADDING + col * step, y: PADDING + row * step };
}

const CENTERS = Array.from({ length: NODES }, (_, i) => nodeCenter(i));

function hitIndex(x: number, y: number, used: ReadonlySet<number>): number | null {
  const r2 = HIT_RADIUS * HIT_RADIUS;
  for (let i = 0; i < NODES; i++) {
    if (used.has(i)) continue;
    const dx = x - CENTERS[i].x;
    const dy = y - CENTERS[i].y;
    if (dx * dx + dy * dy <= r2) return i;
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Board-local point from window coordinates. Never uses locationX/Y after grant:
 * once the pointer leaves the view, those are relative to whatever is under the
 * finger and the trail jumps to the top of the box.
 */
function localFromPage(pageX: number, pageY: number, origin: { x: number; y: number }) {
  return { x: pageX - origin.x, y: pageY - origin.y };
}

function originFromGrant(native: NativeTouchEvent): { x: number; y: number } | null {
  const { pageX, pageY, locationX, locationY } = native;
  if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return null;
  if (Number.isFinite(locationX) && Number.isFinite(locationY)) {
    return { x: pageX - locationX, y: pageY - locationY };
  }
  return null;
}

export function PatternInput({
  value,
  onChange,
  onComplete,
  error = false,
  disabled = false,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  /** Fired when the finger lifts. Shorter than 4 dots is still reported so the parent can show an error. */
  onComplete?: (value: number[]) => void;
  error?: boolean;
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const [buttonEntry, setButtonEntry] = useState(false);
  const [stroke, setStroke] = useState<number[] | null>(null);
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  const boardRef = useRef<View>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const strokingRef = useRef(false);
  const strokeRef = useRef<number[]>([]);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const shown = stroke ?? value;
  const used = useMemo(() => new Set(shown), [shown]);
  const active = error ? palette.danger : palette.accent;
  const idle = palette.borderStrong;

  const measureOrigin = () => {
    if (strokingRef.current) return;
    boardRef.current?.measureInWindow((x, y) => {
      if (strokingRef.current) return;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        originRef.current = { x, y };
      }
    });
  };

  const addNode = (node: number) => {
    const current = strokeRef.current;
    if (current.includes(node)) return;
    const next = appendPatternNode(current, node);
    strokeRef.current = next;
    setStroke(next);
    onChangeRef.current(next);
    haptics.selection();
  };

  const probe = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const node = hitIndex(x, y, new Set(strokeRef.current));
    if (node !== null) addNode(node);
    setFinger({ x: clamp(x, 0, SIZE), y: clamp(y, 0, SIZE) });
  };

  const finishStroke = () => {
    strokingRef.current = false;
    const path = strokeRef.current;
    setFinger(null);
    setStroke(null);
    if (path.length === 0) return;
    if (path.length < 4) {
      haptics.warning();
      onChangeRef.current([]);
    } else {
      onChangeRef.current(path);
    }
    onCompleteRef.current?.(path);
  };

  const probeRef = useRef(probe);
  probeRef.current = probe;
  const finishStrokeRef = useRef(finishStroke);
  finishStrokeRef.current = finishStroke;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onStartShouldSetPanResponderCapture: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        if (disabledRef.current) return;
        strokeRef.current = [];
        setStroke([]);
        onChangeRef.current([]);
        const guessed = originFromGrant(evt.nativeEvent);
        if (guessed) originRef.current = guessed;
        else {
          boardRef.current?.measureInWindow((x, y) => {
            if (Number.isFinite(x) && Number.isFinite(y)) originRef.current = { x, y };
          });
        }
        strokingRef.current = true;
        const local = localFromPage(evt.nativeEvent.pageX, evt.nativeEvent.pageY, originRef.current);
        probeRef.current(local.x, local.y);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        if (disabledRef.current) return;
        const local = localFromPage(evt.nativeEvent.pageX, evt.nativeEvent.pageY, originRef.current);
        probeRef.current(local.x, local.y);
      },
      onPanResponderRelease: () => finishStrokeRef.current(),
      onPanResponderTerminate: () => finishStrokeRef.current(),
    }),
  ).current;

  const last = shown.length > 0 ? CENTERS[shown[shown.length - 1]] : null;

  if (buttonEntry) return <View style={{ gap: 8 }}>
    <Text variant="bodyMedium">Choose dots in order. Dots between two choices are added automatically.</Text>
    <View accessibilityLabel="Pattern dots" style={{ flexDirection: "row", flexWrap: "wrap", width: 240, alignSelf: "center", gap: 8 }}>
      {CENTERS.map((_, node) => <PressableScale key={node} accessibilityRole="button"
        accessibilityLabel={`Dot ${node + 1}, row ${Math.floor(node / 3) + 1}, column ${node % 3 + 1}`}
        accessibilityState={{ disabled: disabled || value.includes(node) }} disabled={disabled || value.includes(node)}
        style={{ width: 72, height: 72, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: value.includes(node) ? palette.secondaryContainer : palette.surfaceContainerHigh }}
        onPress={() => { strokeRef.current = value; addNode(node); setStroke(null); }}>
        <Text variant="titleLarge" style={{ color: value.includes(node) ? palette.onSecondaryContainer : palette.onSurface }}>{node + 1}</Text>
      </PressableScale>)}
    </View>
    <Text variant="bodySmall" accessibilityLiveRegion="polite">{value.length} dots selected</Text>
    <Button label="Clear pattern" variant="ghost" disabled={disabled || !value.length}
      onPress={() => { strokeRef.current = []; setStroke(null); onChange([]); }} />
    <Button label="Submit pattern" disabled={disabled || !value.length}
      onPress={() => { strokeRef.current = value; finishStroke(); }} />
    <Button label="Draw pattern instead" variant="ghost" disabled={disabled} onPress={() => setButtonEntry(false)} />
  </View>;

  const webPointerProps =
    Platform.OS === "web"
      ? ({
          onPointerDown: (event: {
            currentTarget: { setPointerCapture?: (id: number) => void };
            nativeEvent?: { pointerId?: number };
            pointerId?: number;
          }) => {
            const id = event.nativeEvent?.pointerId ?? event.pointerId;
            if (typeof id !== "number") return;
            try {
              event.currentTarget.setPointerCapture?.(id);
            } catch {
              /* ignore */
            }
          },
        } as object)
      : null;

   return (<View style={{ gap: 8 }}>
    <View
      ref={boardRef}
      collapsable={false}
      onLayout={measureOrigin}
      {...responder.panHandlers}
      {...webPointerProps}
      accessibilityLabel="Pattern lock. Draw to connect at least four dots."
      accessibilityState={{ disabled }}
      style={[styles.board, { opacity: disabled ? 0.55 : 1 }]}
    >
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill} pointerEvents="none">
        {shown.slice(1).map((node, i) => {
          const from = CENTERS[shown[i]];
          const to = CENTERS[node];
          return (
            <Line
              key={`${shown[i]}-${node}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={active}
              strokeWidth={LINE_WIDTH}
              strokeLinecap="round"
            />
          );
        })}
        {last && finger ? (
          <Line
            x1={last.x}
            y1={last.y}
            x2={finger.x}
            y2={finger.y}
            stroke={active}
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeOpacity={0.55}
          />
        ) : null}
      </Svg>
      {CENTERS.map((center, node) => {
        const selected = used.has(node);
        return (
          <View
            key={node}
            pointerEvents="none"
            style={[
              styles.halo,
              {
                left: center.x - HALO / 2,
                top: center.y - HALO / 2,
                backgroundColor: selected ? (error ? palette.dangerSoft : palette.accentSoft) : "transparent",
              },
            ]}
          >
            <View
              style={[
                styles.dot,
                {
                  borderColor: selected ? active : idle,
                  backgroundColor: selected ? active : "transparent",
                },
              ]}
            />
          </View>
        );
      })}
    </View>
    <Button label="Use buttons to enter pattern" variant="ghost" disabled={disabled} onPress={() => { setStroke(null); setFinger(null); setButtonEntry(true); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    width: SIZE,
    height: SIZE,
    alignSelf: "center",
    overflow: "hidden",
    ...(Platform.OS === "web" ? { userSelect: "none", touchAction: "none" } : {}),
  },
  halo: {
    position: "absolute",
    width: HALO,
    height: HALO,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    borderWidth: 2,
  },
});
