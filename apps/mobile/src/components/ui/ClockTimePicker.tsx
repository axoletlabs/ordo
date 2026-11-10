import { usePanelDraftField } from "./draft-dismiss";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, TextInput, View, useWindowDimensions, type TextInputProps, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedProps, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, resolveFont, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { CLOCK_CENTER, CLOCK_SIZE, clockPoint, clockValueAt, stepClockValue, type ClockField } from "../../lib/clock-dial";
import { PressableScale } from "./PressableScale";
import { Segmented } from "./Segmented";
import { Text } from "./Text";

const AnimatedReadout = Animated.createAnimatedComponent(TextInput);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLabel = Animated.createAnimatedComponent(SvgText);
function DialLabel({ x, y, hand, children }: { x: number; y: number; hand: SharedValue<{ x: number; y: number }>; children: string }) {
  const { palette } = useTheme();
  const props = useAnimatedProps(() => ({ fill: Math.hypot(x - hand.value.x, y - hand.value.y) <= 24 ? palette.onPrimary : palette.onSurface }));
  return <AnimatedLabel x={x} y={y + 5.5} textAnchor="middle" fontSize={16}
    fontFamily={resolveFont("sans", "400")} animatedProps={props}>{children}</AnimatedLabel>;
}
function ClockReadout({ selected, active, fallback, color }: { selected: SharedValue<number>; active: boolean; fallback: number; color: string }) {
  const { expressive } = useTheme();
  const { fontScale } = useWindowDimensions();
  const props = useAnimatedProps<TextInputProps & { text: string }>(() => {
    const text = String(active ? selected.value : fallback).padStart(2, "0");
    return { text, defaultValue: text, ...(Platform.OS === "web" ? { value: text } : {}) };
  });
  return <AnimatedReadout editable={false} pointerEvents="none" focusable={false} tabIndex={-1} caretHidden accessible={false} aria-hidden
    importantForAccessibility="no-hide-descendants" underlineColorAndroid="transparent"
    defaultValue={String(fallback).padStart(2, "0")} animatedProps={props}
    style={{ width: Math.max(64, 52 * fontScale), padding: 0, color, textAlign: "center", fontSize: 45, lineHeight: 52,
      fontFamily: resolveFont("sans", expressive ? "500" : "400"), fontWeight: expressive ? "500" : "400", includeFontPadding: false }} />;
}
const PERIODS = [{ value: "am", label: "AM" }, { value: "pm", label: "PM" }] as const;
const INDEXES = Array.from({ length: 12 }, (_, index) => index);
/** Rendered dial size. Geometry stays in CLOCK_SIZE units; the SVG viewBox scales. */
const DIAL_DISPLAY_SIZE = 224;

/** One gesture/adjustable surface paints the dial; numerals have no hooks or animations. */
export function ClockTimePicker({ hour, minute, hour12, disabled = false, onChange }: {
  hour: number; minute: number; hour12: boolean; disabled?: boolean;
  onChange: (hour: number, minute: number) => void;
}) {
  const markDraft = usePanelDraftField(`${hour}:${minute}`);
  const { palette } = useTheme();
  const change = (nextHour: number, nextMinute: number) => { markDraft(`${nextHour}:${nextMinute}`); onChange(nextHour, nextMinute); };
  const [field, setField] = useState<ClockField>("hour");
  const shownHour = hour12 ? hour % 12 || 12 : hour;
  const value = field === "hour" ? shownHour : minute;
  const valueText = field === "minute" ? `${value} minutes` : hour12 ? `${value} ${hour >= 12 ? "PM" : "AM"}` : `${String(value).padStart(2, "0")} hours`;
  const min = field === "hour" && hour12 ? 1 : 0;
  const max = field === "minute" ? 59 : hour12 ? 12 : 23;
  const selected = useSharedValue(value);
  const width = useSharedValue(CLOCK_SIZE);
  const probed = useSharedValue(false);
  useEffect(() => { selected.value = value; }, [value, selected]);
  const handPoint = useDerivedValue(() => clockPoint(field === "hour" ? selected.value % 12 : selected.value,
    field === "hour" ? 12 : 60, field === "hour" && !hour12 && (selected.value === 0 || selected.value > 12)));
  const lineProps = useAnimatedProps(() => ({ x2: handPoint.value.x, y2: handPoint.value.y }));
  const dotProps = useAnimatedProps(() => ({ cx: handPoint.value.x, cy: handPoint.value.y }));
  const minuteDotProps = useAnimatedProps(() => ({ cx: handPoint.value.x, cy: handPoint.value.y, opacity: field === "minute" && selected.value % 5 !== 0 ? 1 : 0 }));
  const setValue = (next: number) => {
    if (disabled || next === value) return;
    haptics.selection();
    change(field === "hour" ? hour12 ? next % 12 + (hour >= 12 ? 12 : 0) : next : hour, field === "minute" ? next : minute);
  };
  const commit = (next: number) => {
    if (disabled) return;
    change(field === "hour" ? hour12 ? next % 12 + (hour >= 12 ? 12 : 0) : next : hour, field === "minute" ? next : minute);
    if (field === "hour") setField("minute");
  };
  const pan = useMemo(() => {
    const probe = (x: number, y: number, step: 1 | 5) => {
      "worklet";
      const next = clockValueAt(x * CLOCK_SIZE / width.value, y * CLOCK_SIZE / width.value, field, hour12, step);
      if (next == null) return;
      probed.value = true;
      if (next !== selected.value) { selected.value = next; runOnJS(haptics.selection)(); }
    };
    return Gesture.Pan().enabled(!disabled).minDistance(0).maxPointers(1)
      .onStart(e => { probed.value = false; probe(e.x, e.y, 5); })
      .onUpdate(e => { probe(e.x, e.y, 1); })
      .onEnd(() => { if (probed.value) runOnJS(commit)(selected.value); })
      .onFinalize((_e, success) => { if (!success) selected.value = value; });
  }, [disabled, field, hour12, hour, minute, selected, width, value, probed]);
  const keyboard = Platform.OS === "web" ? {
    tabIndex: disabled ? -1 as const : 0 as const,
    role: "slider" as const,
    "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": value,
    "aria-valuetext": valueText,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1
        : event.key === "PageUp" ? 5 : event.key === "PageDown" ? -5 : null;
      if (step == null && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault(); event.stopPropagation();
      setValue(event.key === "Home" ? min : event.key === "End" ? max : stepClockValue(value, step!, field, hour12));
    },
  } : {};
  const labels = INDEXES.flatMap((index) => {
    if (field === "minute") return [{ value: index * 5, label: String(index * 5).padStart(2, "0"), inner: false, index }];
    const outer = { value: index || 12, label: String(index || 12), inner: false, index };
    return hour12 ? [outer] : [outer, { value: index === 0 ? 0 : index + 12, label: index === 0 ? "00" : String(index + 12), inner: true, index }];
  });
  return <View style={styles.root}>
    <View style={styles.readout}>
      {(["hour", "minute"] as const).map((part, index) => <React.Fragment key={part}>
        {index ? <Text variant="displayMedium" accessibilityElementsHidden importantForAccessibility="no">:</Text> : null}
        <PressableScale accessibilityRole="button" accessibilityLabel={`Select ${part}`} accessibilityState={{ selected: field === part, disabled }} disabled={disabled}
          accessibilityValue={{ text: String(part === "hour" ? shownHour : minute).padStart(2, "0") }} aria-pressed={field === part}
          onPress={() => setField(part)} stateLayerColor={field === part ? palette.onPrimaryContainer : palette.onSurfaceVariant}
          style={[styles.value, { backgroundColor: field === part ? palette.primaryContainer : palette.surfaceContainerHighest }]}>
          <ClockReadout selected={selected} active={field === part} fallback={part === "hour" ? shownHour : minute}
            color={field === part ? palette.onPrimaryContainer : palette.onSurfaceVariant} />
        </PressableScale>
      </React.Fragment>)}
    </View>
    {hour12 ? <Segmented accessibilityLabel="Day period" disabled={disabled} options={PERIODS} value={hour >= 12 ? "pm" : "am"}
      onChange={(period) => change(hour % 12 + (period === "pm" ? 12 : 0), minute)} /> : null}
    <GestureDetector gesture={pan}><View {...keyboard} testID="reminder-clock" collapsable={false} accessible accessibilityRole="adjustable"
      accessibilityLabel={`Reminder ${field}`} accessibilityHint="Drag the clock hand or adjust the value. Select hour or minute above to switch."
      aria-disabled={disabled} accessibilityState={{ disabled }} accessibilityValue={{ min, max, now: value, text: valueText }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment" || event.nativeEvent.actionName === "decrement") {
          setValue(stepClockValue(value, event.nativeEvent.actionName === "increment" ? 1 : -1, field, hour12));
        }
      }}
      onLayout={(event) => { if (event.nativeEvent.layout.width > 0) width.value = event.nativeEvent.layout.width; }}
      style={[styles.clock, { opacity: disabled ? 0.38 : 1 }, Platform.OS === "web" ? { touchAction: "none", userSelect: "none", outlineColor: palette.primary } as ViewStyle : null]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${CLOCK_SIZE} ${CLOCK_SIZE}`} pointerEvents="none" accessible={Platform.OS === "web" ? undefined : false} aria-hidden>
        <Circle cx={CLOCK_CENTER} cy={CLOCK_CENTER} r={CLOCK_CENTER} fill={palette.surfaceContainerHighest} />
        <AnimatedLine x1={CLOCK_CENTER} y1={CLOCK_CENTER} animatedProps={lineProps} stroke={palette.primary} strokeWidth={2} />
        <AnimatedCircle animatedProps={dotProps} r={24} fill={palette.primary} />
        <Circle cx={CLOCK_CENTER} cy={CLOCK_CENTER} r={4} fill={palette.primary} />
        {labels.map((label) => {
          const point = clockPoint(label.index, 12, label.inner);
          return <DialLabel key={`${label.inner}-${label.value}`} x={point.x} y={point.y} hand={handPoint}>{label.label}</DialLabel>;
        })}
        <AnimatedCircle animatedProps={minuteDotProps} r={3} fill={palette.onPrimary} />
      </Svg>
    </View></GestureDetector>
    <Text accessibilityLiveRegion="polite" style={styles.fieldLive}>{field === "hour" ? "Hour" : "Minutes"}</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: spacing[12] },
  readout: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing[8] },
  value: { minWidth: 84, minHeight: 64, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  clock: { width: "100%", maxWidth: DIAL_DISPLAY_SIZE, aspectRatio: 1, alignSelf: "center", borderRadius: CLOCK_CENTER },
  // Announces field switches without spending a visible caption row.
  fieldLive: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" },
});
