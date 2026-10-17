import React, { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, resolveFont, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { CLOCK_CENTER, CLOCK_SIZE, clockPoint, clockValueAt, stepClockValue, type ClockField } from "../../lib/clock-dial";
import { PressableScale } from "./PressableScale";
import { Segmented } from "./Segmented";
import { Text } from "./Text";

const PERIODS = [{ value: "am", label: "AM" }, { value: "pm", label: "PM" }] as const;
const INDEXES = Array.from({ length: 12 }, (_, index) => index);

/** One gesture/adjustable surface paints the dial; numerals have no hooks or animations. */
export function ClockTimePicker({ hour, minute, hour12, disabled = false, onChange }: {
  hour: number; minute: number; hour12: boolean; disabled?: boolean;
  onChange: (hour: number, minute: number) => void;
}) {
  const { palette } = useTheme();
  const [field, setField] = useState<ClockField>("hour");
  const shownHour = hour12 ? hour % 12 || 12 : hour;
  const value = field === "hour" ? shownHour : minute;
  const valueText = field === "minute" ? `${value} minutes` : hour12 ? `${value} ${hour >= 12 ? "PM" : "AM"}` : `${String(value).padStart(2, "0")} hours`;
  const min = field === "hour" && hour12 ? 1 : 0;
  const max = field === "minute" ? 59 : hour12 ? 12 : 23;
  const inner = field === "hour" && !hour12 && (hour === 0 || hour > 12);
  const hand = clockPoint(field === "hour" ? hour % 12 : minute, field === "hour" ? 12 : 60, inner);
  const width = useRef(CLOCK_SIZE);
  const origin = useRef({ x: 0, y: 0 });
  const gestureField = useRef<ClockField | null>(null);
  const lastValue = useRef<number | null>(null);
  const setValue = (next: number, fromDrag = false) => {
    // Continuous move events can batch before controlled props catch up. A
    // drag back to its starting value must still overwrite the pending choice.
    if (disabled || !fromDrag && next === value) return;
    haptics.selection();
    onChange(field === "hour" ? hour12 ? next % 12 + (hour >= 12 ? 12 : 0) : next : hour, field === "minute" ? next : minute);
  };
  const current = useRef({ disabled, field, hour12, setValue });
  current.current = { disabled, field, hour12, setValue };
  const probe = (event: GestureResponderEvent, dragging = false) => {
    const state = current.current;
    if (state.disabled || gestureField.current !== state.field) return;
    // Page coordinates stay relative to the original surface while dragging,
    // even when a native event's target/location changes under the finger.
    const x = (event.nativeEvent.pageX - origin.current.x) * CLOCK_SIZE / width.current;
    const y = (event.nativeEvent.pageY - origin.current.y) * CLOCK_SIZE / width.current;
    const next = clockValueAt(x, y, state.field, state.hour12, dragging ? 1 : 5);
    if (next == null || next === lastValue.current) return;
    lastValue.current = next;
    state.setValue(next, dragging);
  };
  const probeRef = useRef(probe);
  probeRef.current = probe;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.disabled,
    onMoveShouldSetPanResponder: () => !current.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      if (current.current.disabled) return;
      const { pageX, pageY, locationX, locationY } = event.nativeEvent;
      origin.current = { x: pageX - locationX, y: pageY - locationY };
      gestureField.current = current.current.field;
      lastValue.current = null;
      probeRef.current(event);
    },
    onPanResponderMove: (event) => probeRef.current(event, true),
    onPanResponderRelease: () => {
      if (!current.current.disabled && gestureField.current === "hour" && lastValue.current != null) setField("minute");
      gestureField.current = null;
    },
    onPanResponderTerminate: () => { gestureField.current = null; },
  }), []);
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
          <Text variant="displayMedium" style={{ color: field === part ? palette.onPrimaryContainer : palette.onSurfaceVariant }}>
            {String(part === "hour" ? shownHour : minute).padStart(2, "0")}
          </Text>
        </PressableScale>
      </React.Fragment>)}
    </View>
    {hour12 ? <Segmented accessibilityLabel="Day period" disabled={disabled} options={PERIODS} value={hour >= 12 ? "pm" : "am"}
      onChange={(period) => onChange(hour % 12 + (period === "pm" ? 12 : 0), minute)} /> : null}
    <View {...responder.panHandlers} {...keyboard} testID="reminder-clock" collapsable={false} accessible accessibilityRole="adjustable"
      accessibilityLabel={`Reminder ${field}`} accessibilityHint="Drag the clock hand or adjust the value. Select hour or minute above to switch."
      aria-disabled={disabled} accessibilityState={{ disabled }} accessibilityValue={{ min, max, now: value, text: valueText }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment" || event.nativeEvent.actionName === "decrement") {
          setValue(stepClockValue(value, event.nativeEvent.actionName === "increment" ? 1 : -1, field, hour12));
        }
      }}
      onLayout={(event) => { if (event.nativeEvent.layout.width > 0) width.current = event.nativeEvent.layout.width; }}
      style={[styles.clock, { opacity: disabled ? 0.38 : 1 }, Platform.OS === "web" ? { touchAction: "none", outlineColor: palette.primary } as ViewStyle : null]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${CLOCK_SIZE} ${CLOCK_SIZE}`} pointerEvents="none" accessible={false} aria-hidden>
        <Circle cx={CLOCK_CENTER} cy={CLOCK_CENTER} r={CLOCK_CENTER} fill={palette.surfaceContainerHighest} />
        <Line x1={CLOCK_CENTER} y1={CLOCK_CENTER} x2={hand.x} y2={hand.y} stroke={palette.primary} strokeWidth={2} />
        <Circle cx={hand.x} cy={hand.y} r={24} fill={palette.primary} />
        <Circle cx={CLOCK_CENTER} cy={CLOCK_CENTER} r={4} fill={palette.primary} />
        {labels.map((label) => {
          const point = clockPoint(label.index, 12, label.inner);
          const covered = Math.hypot(point.x - hand.x, point.y - hand.y) <= 24;
          return <SvgText key={`${label.inner}-${label.value}`} x={point.x} y={point.y + 5.5} textAnchor="middle" fontSize={16}
            fontFamily={resolveFont("sans", "400")} fill={covered ? palette.onPrimary : palette.onSurface}>{label.label}</SvgText>;
        })}
        {field === "minute" && minute % 5 !== 0 ? <Circle cx={hand.x} cy={hand.y} r={3} fill={palette.onPrimary} /> : null}
      </Svg>
    </View>
    <Text variant="bodySmall" color="secondary" align="center" accessibilityLiveRegion="polite">{field === "hour" ? "Choose an hour" : "Choose minutes"}</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: spacing[16] },
  readout: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing[8] },
  value: { minWidth: 88, minHeight: 72, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  clock: { width: "100%", maxWidth: CLOCK_SIZE, aspectRatio: 1, alignSelf: "center", borderRadius: CLOCK_CENTER },
});
