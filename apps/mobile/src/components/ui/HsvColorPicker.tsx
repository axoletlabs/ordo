/** Pointer and keyboard HSV picker: a saturation/brightness square plus a hue slider. */
import React, { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { clamp, hueHex, hsvToHex, type Hsv } from "../../lib/hsv-color";
import { layout, radius, spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

const THUMB = 20;
const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];
const webDrag = Platform.OS === "web" ? { touchAction: "none", userSelect: "none" } as ViewStyle : null;

function probePoint(event: GestureResponderEvent, origin: { x: number; y: number }) {
  return { x: event.nativeEvent.pageX - origin.x, y: event.nativeEvent.pageY - origin.y };
}

function useDragSurface(onProbe: (x: number, y: number, width: number, height: number) => void) {
  const origin = useRef({ x: 0, y: 0 });
  const size = useRef({ width: 1, height: 1 });
  const probe = useRef(onProbe);
  probe.current = onProbe;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      const { pageX, pageY, locationX, locationY } = event.nativeEvent;
      origin.current = { x: pageX - locationX, y: pageY - locationY };
      probe.current(locationX, locationY, size.current.width, size.current.height);
    },
    onPanResponderMove: (event) => {
      const point = probePoint(event, origin.current);
      probe.current(point.x, point.y, size.current.width, size.current.height);
    },
  }), []);
  return {
    panHandlers: responder.panHandlers,
    onLayout: (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      if (width > 0 && height > 0) size.current = { width, height };
    },
  };
}

function ColorThumb({ color, left, top }: { color: string; left: number; top: number }) {
  return <View pointerEvents="none" style={[styles.thumb, { left, top, backgroundColor: color }]}>
    <View style={styles.thumbInner} />
  </View>;
}

export function HsvColorPicker({ value, onChange }: { value: Hsv; onChange: (value: Hsv) => void }) {
  const { palette } = useTheme();
  const ids = React.useId().replace(/:/g, "");
  const [square, setSquare] = useState({ width: 0, height: 0 });
  const [slider, setSlider] = useState({ width: 0, height: 0 });
  const hueColor = hueHex(value.h);
  const current = hsvToHex(value);
  const squareDrag = useDragSurface((x, y, width, height) => {
    onChange({ h: value.h, s: clamp(x / width, 0, 1), v: clamp(1 - y / height, 0, 1) });
  });
  const hueDrag = useDragSurface((x, _y, width) => {
    onChange({ ...value, h: clamp(x / width, 0, 1) * 359.999 });
  });
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
      onChange(next);
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
      onChange({ ...value, h: event.key === "Home" ? 0 : event.key === "End" ? 359 : value.h + step! });
    },
  } : {};

  return <View style={styles.root}>
    <View collapsable={false} onLayout={(event) => { squareDrag.onLayout(event); setSquare(event.nativeEvent.layout); }}
      style={styles.squareFrame}>
      <View pointerEvents="none" style={[styles.squarePaint, { borderColor: palette.outlineVariant }]}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" accessible={Platform.OS === "web" ? undefined : false} aria-hidden>
          <Defs>
            <LinearGradient id={`${ids}-sat`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor={hueColor} />
            </LinearGradient>
            <LinearGradient id={`${ids}-val`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity="0" />
              <Stop offset="1" stopColor="#000000" />
            </LinearGradient>
          </Defs>
          <Rect width="100" height="100" fill={`url(#${ids}-sat)`} />
          <Rect width="100" height="100" fill={`url(#${ids}-val)`} />
        </Svg>
      </View>
      {square.width > 0 ? <ColorThumb color={current}
        left={value.s * square.width - THUMB / 2} top={(1 - value.v) * square.height - THUMB / 2} /> : null}
      <View {...squareDrag.panHandlers} {...squareKeys} accessible accessibilityRole="adjustable"
        accessibilityLabel="Saturation and brightness"
        accessibilityHint="Left and right change saturation. Up and down change brightness."
        accessibilityValue={{ text: `${Math.round(value.s * 100)}% saturation, ${Math.round(value.v * 100)}% brightness` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === "increment" ? 0.05
            : event.nativeEvent.actionName === "decrement" ? -0.05 : 0;
          if (delta) onChange({ ...value, v: value.v + delta });
        }}
        style={[StyleSheet.absoluteFill, webDrag]} />
    </View>
    <View collapsable={false} onLayout={(event) => { hueDrag.onLayout(event); setSlider(event.nativeEvent.layout); }}
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
      {slider.width > 0 ? <ColorThumb color={hueColor}
        left={(value.h / 360) * slider.width - THUMB / 2} top={(slider.height - THUMB) / 2} /> : null}
      <View {...hueDrag.panHandlers} {...hueKeys} accessible accessibilityRole="adjustable"
        accessibilityLabel="Hue" accessibilityValue={{ min: 0, max: 360, now: Math.round(value.h) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === "increment" ? 8
            : event.nativeEvent.actionName === "decrement" ? -8 : 0;
          if (delta) onChange({ ...value, h: value.h + delta });
        }}
        style={[StyleSheet.absoluteFill, webDrag]} />
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
