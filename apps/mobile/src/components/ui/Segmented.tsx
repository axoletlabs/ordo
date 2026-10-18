/** Baseline segmented buttons / Expressive connected toggle button group. */
import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { MaterialIcon } from "./MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
const AnimatedText = Animated.createAnimatedComponent(Text);
function SegmentLabel({ label, foreground, selected, labelStyle }: { label: string; foreground: string; selected: boolean; labelStyle?: TextStyle }) {
  const motion = useMaterialMotion();
  const tint = useSharedValue(foreground);
  const selection = useSharedValue(selected ? 1 : 0);
  const previous = useRef({ foreground, selected, reducedMotion: motion.reducedMotion });
  useEffect(() => {
    if (previous.current.foreground === foreground && previous.current.selected === selected && previous.current.reducedMotion === motion.reducedMotion) return;
    previous.current = { foreground, selected, reducedMotion: motion.reducedMotion };
    tint.value = motion.reducedMotion ? foreground : withSpring(foreground, materialMotion.effects.fast);
    selection.value = motion.reducedMotion ? Number(selected) : withSpring(Number(selected), materialMotion.effects.fast);
  }, [foreground, selected, motion.reducedMotion, tint, selection]);
  const labelStyleAnimated = useAnimatedStyle(() => ({ color: tint.value }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: selection.value, width: 22 * selection.value }));
  // Retain the check through deselection; animate its slot with the fade so
  // labels don't jump sideways when the selection changes.
  return <><Animated.View testID="material-segment-check" pointerEvents="none" accessible={false}
    style={[{ overflow: "hidden", flexShrink: 0 }, checkStyle]}><MaterialIcon name="checkmark" size={18} color={foreground} /></Animated.View>
    <AnimatedText testID="material-segment-label" variant="labelLarge" numberOfLines={1} style={[{ flexShrink: 1 }, labelStyle, labelStyleAnimated]}>{label}</AnimatedText></>;
}
export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string; accessibilityLabel?: string; labelStyle?: TextStyle }[]; value: T; onChange: (value: T) => void;
  accessibilityLabel?: string;
  orientation?: "auto" | "horizontal" | "vertical";
  disabled?: boolean;
}
export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel, orientation = "auto", disabled = false }: SegmentedProps<T>) {
  const { palette, expressive } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  // Reserve the selected check for EVERY segment so selecting another option
  // never resizes its neighbors. Narrow windows/large fonts stack, not truncate.
  const minimumWidth = Math.max(0, ...options.map((option) => labelWidths[option.value] ?? 0)) + 22 + 24 + (expressive ? 0 : 2);
  const vertical = orientation === "vertical" || orientation === "auto" && width > 0 && width < minimumWidth * options.length + (expressive ? 2 * (options.length - 1) : 0);
  const visualHeight = Math.max(vertical ? 48 : 40, 20 * fontScale + 16);
  const keyboardProps = Platform.OS === "web" ? {
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
      const focused = radios.indexOf(event.target as HTMLElement);
      if (focused < 0) return;
      let next = focused;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (focused + 1) % options.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (focused + options.length - 1) % options.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else return;
      event.preventDefault();
      const option = options[next];
      if (option && option.value !== value) { haptics.selection(); onChange(option.value); }
      radios[next]?.focus();
    },
  } : {};
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ minHeight: 48, justifyContent: "center" }}>
    {orientation === "auto" ? <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left: 0, right: 0, opacity: 0 }}>
      {options.map((option) => <Text key={option.value} variant="labelLarge" numberOfLines={1}
        style={[{ alignSelf: "flex-start" }, option.labelStyle]} onLayout={(event) => {
          const measured = Math.ceil(event.nativeEvent.layout.width) + 1;
          setLabelWidths((current) => current[option.value] === measured ? current : { ...current, [option.value]: measured });
        }}>{option.label}</Text>)}
    </View> : null}
    <View {...keyboardProps} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.group, {
    gap: expressive ? 2 : 0, backgroundColor: "transparent",
    borderRadius: radius.full,
    ...(vertical ? { flexDirection: "column" as const, height: "auto" as const } : {}),
  }]}>
    {options.map((option, index) => {
      const selected = value === option.value;
      const fg = disabled ? `${palette.onSurface}61` : selected ? expressive ? palette.onSecondary : palette.onSecondaryContainer : palette.onSurface;
      const outer = vertical ? 24 : 20;
      const first = index === 0, last = index === options.length - 1;
      const ends = { topLeft: first, bottomLeft: vertical ? last : first, topRight: vertical ? first : last, bottomRight: last };
      const corners = (inner: number) => ({ topLeft: ends.topLeft ? outer : inner, bottomLeft: ends.bottomLeft ? outer : inner,
        topRight: ends.topRight ? outer : inner, bottomRight: ends.bottomRight ? outer : inner });
      const rest = selected ? outer : corners(radius.sm);
      const pressed = corners(radius.xs);
      const outline = corners(0);
      return <PressableScale key={option.value} accessibilityRole="radio" accessibilityLabel={option.accessibilityLabel ?? option.label}
        {...(Platform.OS === "web" ? { tabIndex: selected ? 0 : -1 } : {})}
        disabled={disabled} accessibilityState={{ checked: selected, disabled }} onPress={() => { if (!selected && !disabled) { haptics.selection(); onChange(option.value); } }}
        stateLayerColor={fg} shape={{ rest: expressive ? rest : outline, pressed: expressive ? pressed : outline }}
        style={[styles.option, vertical ? { flex: 0, width: "100%" } : null]}
        visualStyle={[styles.visual, {
          height: visualHeight,
          ...(vertical ? { flex: 0, flexShrink: 0, minHeight: 48, width: "100%" as const } : {}),
          backgroundColor: disabled ? selected ? `${palette.onSurface}1f` : "transparent" : selected ? expressive ? palette.secondary : palette.secondaryContainer : expressive ? palette.surfaceContainerLow : "transparent",
          borderColor: disabled ? `${palette.onSurface}1f` : palette.outline,
          borderTopWidth: expressive || vertical && !first ? 0 : 1, borderBottomWidth: expressive ? 0 : 1,
          borderLeftWidth: expressive || !vertical && !first ? 0 : 1, borderRightWidth: expressive ? 0 : 1,
          ...(!expressive ? { borderTopLeftRadius: outline.topLeft, borderBottomLeftRadius: outline.bottomLeft,
            borderTopRightRadius: outline.topRight, borderBottomRightRadius: outline.bottomRight } : {}),
        }]}>
          <SegmentLabel label={option.label} foreground={fg} selected={selected} labelStyle={option.labelStyle} />
      </PressableScale>;
    })}
  </View></View>;
}
const styles = StyleSheet.create({
   group: { flexDirection: "row", minHeight: 48 },
   option: { flex: 1, minWidth: 48, minHeight: 48, justifyContent: "center" },
   visual: { alignSelf: "stretch", height: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
});
