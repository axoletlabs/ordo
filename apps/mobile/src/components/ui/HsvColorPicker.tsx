/** Pointer and keyboard HSV picker: a saturation/brightness square plus a hue slider. */
import { usePanelDraftField } from "./draft-dismiss";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { clamp, hueHex, hsvToHex, type Hsv } from "../../lib/hsv-color";
import { layout, radius, spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

const THUMB = 20;
const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];
const webDrag = Platform.OS === "web" ? { touchAction: "none", userSelect: "none" } as ViewStyle : null;

function ColorThumb({ hsv, hue = false, width, height }: { hsv: SharedValue<Hsv>; hue?: boolean; width: number; height: number }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (hue ? hsv.value.h / 360 : hsv.value.s) * width - THUMB / 2 },
      { translateY: hue ? (height - THUMB) / 2 : (1 - hsv.value.v) * height - THUMB / 2 }],
    backgroundColor: hue ? hueHex(hsv.value.h) : hsvToHex(hsv.value),
  }));
  return <Animated.View pointerEvents="none" style={[styles.thumb, style]}><View style={styles.thumbInner} /></Animated.View>;
}

export function HsvColorPicker({ value, onChange }: { value: Hsv; onChange: (value: Hsv) => void }) {
  const markDraft = usePanelDraftField(JSON.stringify(value));
  const change = (next: Hsv) => { markDraft(JSON.stringify(next)); onChange(next); };
  const { palette } = useTheme();
  const ids = React.useId().replace(/:/g, "");
  const [square, setSquare] = useState({ width: 0, height: 0 });
  const [slider, setSlider] = useState({ width: 0, height: 0 });
  const hsv = useSharedValue(value);
  useEffect(() => { hsv.value = value; }, [value, hsv]);
  const paint = useAnimatedStyle(() => ({ backgroundColor: hueHex(hsv.value.h) }));
  const squareDrag = useMemo(() => Gesture.Pan().minDistance(0).maxPointers(1)
    .onStart(e => { hsv.value = { ...hsv.value, s: clamp(e.x / Math.max(1, square.width), 0, 1), v: clamp(1 - e.y / Math.max(1, square.height), 0, 1) }; })
    .onUpdate(e => { hsv.value = { ...hsv.value, s: clamp(e.x / Math.max(1, square.width), 0, 1), v: clamp(1 - e.y / Math.max(1, square.height), 0, 1) }; })
    .onEnd(() => { runOnJS(change)(hsv.value); })
    .onFinalize((_e, success) => { if (!success) hsv.value = value; }), [hsv, onChange, square, value]);
  const hueDrag = useMemo(() => Gesture.Pan().minDistance(0).maxPointers(1)
    .onStart(e => { hsv.value = { ...hsv.value, h: clamp(e.x / Math.max(1, slider.width), 0, 1) * 359.999 }; })
    .onUpdate(e => { hsv.value = { ...hsv.value, h: clamp(e.x / Math.max(1, slider.width), 0, 1) * 359.999 }; })
    .onEnd(() => { runOnJS(change)(hsv.value); })
    .onFinalize((_e, success) => { if (!success) hsv.value = value; }), [hsv, onChange, slider, value]);
  const squareKeys = Platform.OS === "web" ? {
    tabIndex: 0 as const,
    role: "slider" as const,
    "aria-valuemin": 0, "aria-valuemax": 100,
    "aria-valuenow": Math.round(value.s * 100),
    "aria-valuetext": `${Math.round(value.s * 100)}% saturation, ${Math.round(value.v * 100)}% brightness`,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      const next = event.key === "ArrowRight" ? { ...value, s: value.s + step }
        : event.key === "ArrowLeft" ? { ...value, s: value.s - step }
        : event.key === "ArrowUp" ? { ...value, v: value.v + step }
        : event.key === "ArrowDown" ? { ...value, v: value.v - step }
        : event.key === "Home" ? { ...value, s: 0 }
        : event.key === "End" ? { ...value, s: 1 }
        : event.key === "PageUp" ? { ...value, v: 1 }
        : event.key === "PageDown" ? { ...value, v: 0 }
        : null;
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      change(next);
    },
  } : {};
  const hueKeys = Platform.OS === "web" ? {
    tabIndex: 0 as const,
    role: "slider" as const,
    "aria-valuemin": 0, "aria-valuemax": 360,
    "aria-valuenow": Math.round(value.h),
    "aria-valuetext": `${Math.round(value.h)} degrees hue`,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 2
        : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -2
        : event.key === "PageUp" ? 12 : event.key === "PageDown" ? -12 : null;
      if (step == null && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      event.stopPropagation();
      change({ ...value, h: event.key === "Home" ? 0 : event.key === "End" ? 359 : value.h + step! });
    },
  } : {};

  return <View style={styles.root}>
    <View collapsable={false} onLayout={(event) => { setSquare(event.nativeEvent.layout); }}
      style={styles.squareFrame}>
      <Animated.View pointerEvents="none" style={[styles.squarePaint, { borderColor: palette.outlineVariant }, paint]}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" accessible={Platform.OS === "web" ? undefined : false} aria-hidden>
          <Defs>
            <LinearGradient id={`${ids}-sat`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id={`${ids}-val`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity="0" />
              <Stop offset="1" stopColor="#000000" />
            </LinearGradient>
          </Defs>
          <Rect width="100" height="100" fill={`url(#${ids}-sat)`} />
          <Rect width="100" height="100" fill={`url(#${ids}-val)`} />
        </Svg>
      </Animated.View>
      {square.width > 0 ? <ColorThumb hsv={hsv} width={square.width} height={square.height} /> : null}
      <GestureDetector gesture={squareDrag}><View {...squareKeys} accessible accessibilityRole="adjustable"
        accessibilityLabel="Saturation and brightness"
        accessibilityHint="Left and right change saturation. Up and down change brightness."
        accessibilityValue={{ text: `${Math.round(value.s * 100)}% saturation, ${Math.round(value.v * 100)}% brightness` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === "increment" ? 0.05
            : event.nativeEvent.actionName === "decrement" ? -0.05 : 0;
          if (delta) change({ ...value, v: value.v + delta });
        }}
        style={[StyleSheet.absoluteFill, webDrag]} /></GestureDetector>
    </View>
    <View collapsable={false} onLayout={(event) => { setSlider(event.nativeEvent.layout); }}
      style={styles.hue}>
      <View pointerEvents="none" style={[styles.hueTrack, { borderColor: palette.outlineVariant }]}>
        <Svg width="100%" height="100%" viewBox="0 0 360 1" preserveAspectRatio="none" accessible={Platform.OS === "web" ? undefined : false} aria-hidden>
          <Defs>
            <LinearGradient id={`${ids}-hue`} x1="0" y1="0" x2="1" y2="0">
              {HUE_STOPS.map((hue) => <Stop key={hue} offset={String(hue / 360)} stopColor={hueHex(hue === 360 ? 0 : hue)} />)}
            </LinearGradient>
          </Defs>
          <Rect width="360" height="1" fill={`url(#${ids}-hue)`} />
        </Svg>
      </View>
      {slider.width > 0 ? <ColorThumb hsv={hsv} hue width={slider.width} height={slider.height} /> : null}
      <GestureDetector gesture={hueDrag}><View {...hueKeys} accessible accessibilityRole="adjustable"
        accessibilityLabel="Hue" accessibilityValue={{ min: 0, max: 360, now: Math.round(value.h) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === "increment" ? 8
            : event.nativeEvent.actionName === "decrement" ? -8 : 0;
          if (delta) change({ ...value, h: value.h + delta });
        }}
        style={[StyleSheet.absoluteFill, webDrag]} /></GestureDetector>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: spacing[12] },
  squareFrame: { width: "100%", height: 168, overflow: "visible" },
  squarePaint: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  hue: {
    width: "100%",
    height: layout.touchTargetMin,
    justifyContent: "center",
    overflow: "visible",
  },
  hueTrack: {
    height: 16,
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    left: 0, top: 0,
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    zIndex: 1,
  },
  thumbInner: {
    ...StyleSheet.absoluteFill,
    borderRadius: THUMB / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.4)",
  },
});
