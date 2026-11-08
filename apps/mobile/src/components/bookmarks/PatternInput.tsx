/**
 * Android-style 3×3 pattern lock: draw through dots, connecting lines follow
 * the finger, and lifting completes the pattern.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { radius } from "../../theme/tokens";
import { PressableScale } from "../ui/PressableScale";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { usePanelDraftField } from "../ui/draft-dismiss";
import { appendPatternNode } from "../../lib/pattern-input";
const AnimatedPath = Animated.createAnimatedComponent(Path);
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

function PatternDot({ node, nodes, error }: { node: number; nodes: SharedValue<number[]>; error: boolean }) {
  const { palette } = useTheme();
  const c = CENTERS[node];
  const halo = useAnimatedStyle(() => ({ backgroundColor: nodes.value.includes(node) ? error ? palette.dangerSoft : palette.accentSoft : "transparent" }));
  const dot = useAnimatedStyle(() => ({ borderColor: nodes.value.includes(node) ? error ? palette.danger : palette.accent : palette.borderStrong,
    backgroundColor: nodes.value.includes(node) ? error ? palette.danger : palette.accent : "transparent" }));
  return <Animated.View pointerEvents="none" style={[styles.halo, { left: c.x - HALO / 2, top: c.y - HALO / 2 }, halo]}>
    <Animated.View style={[styles.dot, dot]} />
  </Animated.View>;
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
  const nodes = useSharedValue<number[]>(value);
  const finger = useSharedValue({ x: 0, y: 0 });
  const drawing = useSharedValue(false);
  const trackDraft = usePanelDraftField(JSON.stringify(value));
  const active = error ? palette.danger : palette.accent;
  useEffect(() => { if (!drawing.value) nodes.value = value; }, [value, nodes, drawing]);
  const finishStroke = (path: number[]) => {
    if (!path.length) return;
    if (path.length < 4) haptics.warning();
    trackDraft(JSON.stringify(path.length < 4 ? [] : path));
    onChange(path.length < 4 ? [] : path);
    onComplete?.(path);
  };
  const pan = useMemo(() => {
    const probe = (x: number, y: number) => {
      "worklet";
      finger.value = { x: Math.max(0, Math.min(SIZE, x)), y: Math.max(0, Math.min(SIZE, y)) };
      for (let node = 0; node < NODES; node++) {
        if (nodes.value.includes(node)) continue;
        const c = CENTERS[node];
        if ((x - c.x) ** 2 + (y - c.y) ** 2 <= HIT_RADIUS ** 2) {
          nodes.value = appendPatternNode(nodes.value, node);
          runOnJS(haptics.selection)(); break;
        }
      }
    };
    return Gesture.Pan().enabled(!disabled).minDistance(0).maxPointers(1)
      .onStart(e => { nodes.value = []; drawing.value = true; probe(e.x, e.y); })
      .onUpdate(e => { probe(e.x, e.y); })
      .onEnd(() => { drawing.value = false; const path = nodes.value; if (path.length < 4) nodes.value = []; runOnJS(finishStroke)(path); })
      .onFinalize((_e, success) => { drawing.value = false;
        if (!success) { nodes.value = []; runOnJS(onChange)([]); }
      });
  }, [disabled, onChange, onComplete, nodes, finger, drawing]);
  const pathProps = useAnimatedProps(() => {
    let d = "";
    for (let i = 0; i < nodes.value.length; i++) {
      const c = CENTERS[nodes.value[i]]; d += `${i ? "L" : "M"}${c.x},${c.y} `;
    }
    if (drawing.value && nodes.value.length) d += `L${finger.value.x},${finger.value.y}`;
    return { d };
  });

  if (buttonEntry) return <View style={{ gap: 8 }}>
    <Text variant="bodyMedium">Choose dots in order. Dots between two choices are added automatically.</Text>
    <View accessibilityLabel="Pattern dots" style={{ flexDirection: "row", flexWrap: "wrap", width: 240, alignSelf: "center", gap: 8 }}>
      {CENTERS.map((_, node) => <PressableScale key={node} accessibilityRole="button"
        accessibilityLabel={`Dot ${node + 1}, row ${Math.floor(node / 3) + 1}, column ${node % 3 + 1}`}
        accessibilityState={{ disabled: disabled || value.includes(node) }} disabled={disabled || value.includes(node)}
        style={{ width: 72, height: 72, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: value.includes(node) ? palette.secondaryContainer : palette.surfaceContainerHigh }}
        onPress={() => { const next = appendPatternNode(value, node); trackDraft(JSON.stringify(next)); onChange(next); haptics.selection(); }}>
        <Text variant="titleLarge" style={{ color: value.includes(node) ? palette.onSecondaryContainer : palette.onSurface }}>{node + 1}</Text>
      </PressableScale>)}
    </View>
    <Text variant="bodySmall" accessibilityLiveRegion="polite">{value.length} dots selected</Text>
    <Button label="Clear pattern" variant="ghost" disabled={disabled || !value.length}
      onPress={() => onChange([])} />
    <Button label="Submit pattern" disabled={disabled || !value.length}
      onPress={() => finishStroke(value)} />
    <Button label="Draw pattern instead" variant="ghost" disabled={disabled} onPress={() => setButtonEntry(false)} />
  </View>;

  return <View style={{ gap: 8 }}>
    <GestureDetector gesture={pan}><View collapsable={false}
      accessibilityLabel="Pattern lock. Draw to connect at least four dots." accessibilityState={{ disabled }}
      style={[styles.board, { opacity: disabled ? 0.55 : 1 }]}>
      <Svg width={SIZE} height={SIZE} pointerEvents="none" style={StyleSheet.absoluteFill}>
        <AnimatedPath animatedProps={pathProps} fill="none" stroke={active} strokeWidth={LINE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      {CENTERS.map((_, node) => <PatternDot key={node} node={node} nodes={nodes} error={error} />)}
    </View></GestureDetector>
    <Button label="Use buttons to enter pattern" variant="ghost" disabled={disabled} onPress={() => setButtonEntry(true)} />
  </View>;
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
