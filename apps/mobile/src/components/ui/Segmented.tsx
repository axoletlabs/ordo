/** Baseline segmented buttons / Expressive connected toggle button group. */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { MaterialIcon } from "./MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
type SegmentMotion = ReturnType<typeof useMaterialMotion>;
type SegmentPalette = ReturnType<typeof useTheme>["palette"];
const SegmentLabel = React.memo(function SegmentLabel({ label, foreground,
  selected, labelStyle, reducedMotion }: {
  label: string; foreground: string;
  selected: boolean; labelStyle?: TextStyle; reducedMotion: boolean;
}) {
  // The label uses its container's committed on-color. Only the check's
  // appearance fades; fading both foreground and fill loses contrast midway.
  const progress = useSharedValue(selected ? 1 : 0);
  const previous = useRef({ selected, reducedMotion });
  useLayoutEffect(() => {
    if (previous.current.selected === selected && previous.current.reducedMotion === reducedMotion) return;
    previous.current = { selected, reducedMotion };
    progress.value = reducedMotion ? Number(selected) : withSpring(Number(selected), materialMotion.effects.fast);
  }, [selected, reducedMotion, progress]);
  const checkStyle = useAnimatedStyle(() => ({ opacity: progress.value, width: 22 * progress.value }));
  // Retain the check through deselection; animate its slot with the fade so
  // labels don't jump sideways when the selection changes.
  return <><Animated.View testID="material-segment-check" pointerEvents="none" accessible={false}
    style={[{ overflow: "hidden", flexShrink: 0 }, checkStyle]}><MaterialIcon name="checkmark" size={18} color={foreground} /></Animated.View>
    <Text testID="material-segment-label" variant="labelLarge" numberOfLines={1} style={[{ flexShrink: 1 }, labelStyle, { color: foreground }]}>{label}</Text></>;
});

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string; accessibilityLabel?: string; labelStyle?: TextStyle }[]; value: T; onChange: (value: T) => void;
  accessibilityLabel?: string;
  orientation?: "auto" | "horizontal" | "vertical";
  /** Keep related choices in one row, scrolling instead of truncating labels. */
  scrollable?: boolean;
  disabled?: boolean;
}

/** One option. Memoized so selecting another segment doesn't repaint every
 * unchanged pressable and label in a long (e.g. typeface) group. */
const Segment = React.memo(function Segment({ value, label, accessibilityLabel, labelStyle, selected, disabled,
  expressive, vertical, height, first, last, outer, palette, motion, onSelect }: {
  value: string; label: string; accessibilityLabel?: string; labelStyle?: TextStyle;
  selected: boolean; disabled: boolean; expressive: boolean; vertical: boolean;
  height: number; first: boolean; last: boolean; outer: number; palette: SegmentPalette;
  motion: SegmentMotion; onSelect: (value: string) => void;
}) {
  const muted = `${palette.onSurface}61`;
  const idleForeground = disabled ? muted : palette.onSurface;
  const selectedForeground = disabled ? muted : expressive ? palette.onSecondary : palette.onSecondaryContainer;
  const foreground = selected ? selectedForeground : idleForeground;
  const ends = { topLeft: first, bottomLeft: vertical ? last : first, topRight: vertical ? first : last, bottomRight: last };
  const corners = (inner: number) => ({ topLeft: ends.topLeft ? outer : inner, bottomLeft: ends.bottomLeft ? outer : inner,
    topRight: ends.topRight ? outer : inner, bottomRight: ends.bottomRight ? outer : inner });
  const rest = selected ? outer : corners(radius.sm);
  const pressed = corners(radius.xs);
  const outline = corners(0);
  // Only the Expressive connected group morphs corners on press. Baseline
  // buttons keep their outline shape, but still pass a shape: PressableScale
  // selects its implementation from the shape's presence, so omitting it in
  // Standard would swap pressables (and remount focus/press) on mode change.
  const shape = { rest: expressive ? rest : outline, pressed: expressive ? pressed : outline };
  return <PressableScale
    accessibilityRole="radio"
    accessibilityLabel={accessibilityLabel ?? label}
    {...(Platform.OS === "web" ? { tabIndex: selected ? 0 : -1 } : {})}
    disabled={disabled}
    accessibilityState={{ checked: selected, disabled }}
    onPress={() => onSelect(value)}
    stateLayerColor={foreground}
    shape={shape}
    motion={motion}
    style={[styles.option, vertical ? { flex: 0, width: "100%" } : null]}
    visualStyle={[styles.visual, {
      height,
      ...(vertical ? { flex: 0, flexShrink: 0, minHeight: 48, width: "100%" as const } : {}),
      backgroundColor: disabled ? selected ? `${palette.onSurface}1f` : "transparent" : selected ? expressive ? palette.secondary : palette.secondaryContainer : expressive ? palette.surfaceContainerLow : "transparent",
      borderColor: disabled ? `${palette.onSurface}1f` : palette.outline,
      borderTopWidth: expressive || vertical && !first ? 0 : 1, borderBottomWidth: expressive ? 0 : 1,
      borderLeftWidth: expressive || !vertical && !first ? 0 : 1, borderRightWidth: expressive ? 0 : 1,
      ...(!expressive ? { borderTopLeftRadius: outline.topLeft, borderBottomLeftRadius: outline.bottomLeft,
        borderTopRightRadius: outline.topRight, borderBottomRightRadius: outline.bottomRight } : {}),
    }]}>
    <SegmentLabel label={label} foreground={foreground} selected={selected} labelStyle={labelStyle}
      reducedMotion={motion.reducedMotion} />
  </PressableScale>;
}, function segmentPropsEqual(previous, next) {
  // Compare the option's fields, not the caller's object identity: inline
  // options arrays (menus, lock prompts) still bail when nothing changed.
  return previous.value === next.value && previous.label === next.label
    && previous.accessibilityLabel === next.accessibilityLabel && previous.labelStyle === next.labelStyle
    && previous.selected === next.selected && previous.disabled === next.disabled
    && previous.expressive === next.expressive && previous.vertical === next.vertical
    && previous.height === next.height && previous.first === next.first && previous.last === next.last
    && previous.outer === next.outer && previous.palette === next.palette
    && previous.motion === next.motion && previous.onSelect === next.onSelect;
});

export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel, orientation = "auto", scrollable = false, disabled = false }: SegmentedProps<T>) {
  const { palette, expressive } = useTheme();
  const motion = useMaterialMotion();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const measuredWidths = useRef<Record<string, number>>({});
  const pendingWidths = useRef<Record<string, number> | null>(null);
  const flushQueued = useRef(false);
  const generation = useRef(0);
  const flushMeasures = useCallback(() => {
    flushQueued.current = false;
    const pending = pendingWidths.current;
    pendingWidths.current = null;
    if (!pending) return;
    // Crossing labels report in separate layout callbacks. Commit them as one
    // state update instead of re-rendering the whole group (and every animated
    // segment) once per label during a heavy first mount. The microtask
    // checkpoint lands before the next macrotask, so it adds no timer/frame
    // boundary beyond the intermediate dispatch commit itself.
    setLabelWidths((current) => {
      let changed = false;
      const next = { ...current };
      for (const key of Object.keys(pending)) {
        const measured = pending[key];
        if (next[key] !== measured) { next[key] = measured; changed = true; }
      }
      return changed ? next : current;
    });
  }, []);
  const measure = useCallback((option: string, measured: number) => {
    if (measuredWidths.current[option] === measured) return;
    measuredWidths.current[option] = measured;
    pendingWidths.current = { ...pendingWidths.current, [option]: measured };
    if (flushQueued.current) return;
    flushQueued.current = true;
    const scheduled = generation.current;
    queueMicrotask(() => {
      // The group can unmount (or recycle effects) between the layout event and
      // the microtask checkpoint; a stale flush must not touch state.
      if (generation.current !== scheduled) return;
      flushMeasures();
    });
  }, [flushMeasures]);
  // Layout cleanup runs synchronously with the unmount commit, before any
  // pending width microtask can reach a torn-down tree.
  React.useLayoutEffect(() => () => {
    generation.current += 1;
    pendingWidths.current = null;
    flushQueued.current = false;
  }, []);
  // The latest selection props stay behind a stable callback so memoized
  // segments don't all invalidate when the caller passes a fresh arrow.
  // Publish them only after commit: a transition render can be discarded
  // (interrupted, or a later sibling suspends). Writing the ref during render
  // would leave the next press using a value/callback that never committed.
  const latestSelection = useRef({ value, disabled, onChange });
  React.useLayoutEffect(() => {
    latestSelection.current = { value, disabled, onChange };
  }, [value, disabled, onChange]);
  const select = useCallback((next: string) => {
    const current = latestSelection.current;
    if (current.disabled || current.value === next) return;
    haptics.selection();
    current.onChange(next as T);
  }, []);
  // Reserve the selected check for EVERY segment so selecting another option
  // never resizes its neighbors. Narrow windows/large fonts stack, not truncate.
  const minimumWidth = Math.max(0, ...options.map((option) => labelWidths[option.value] ?? 0)) + 22 + 24 + (expressive ? 0 : 2);
  const horizontalScroll = scrollable && orientation !== "vertical";
  const groupGap = expressive ? 2 : 0;
  const minimumGroupWidth = minimumWidth * options.length + groupGap * Math.max(0, options.length - 1);
  const vertical = orientation === "vertical" || !horizontalScroll && orientation === "auto" && width > 0 && width < minimumGroupWidth;
  const selectedIndex = options.findIndex((option) => option.value === value);
  useEffect(() => {
    if (!horizontalScroll || width <= 0 || selectedIndex < 0) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, selectedIndex * (minimumWidth + groupGap) - (width - minimumWidth) / 2), animated: false });
  }, [horizontalScroll, width, selectedIndex, minimumWidth, groupGap]);
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
  const group = <View {...keyboardProps} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.group, {
    gap: groupGap, backgroundColor: "transparent",
    borderRadius: radius.full,
    ...(horizontalScroll ? { minWidth: minimumGroupWidth, flexGrow: 1 } : {}),
    ...(vertical ? { flexDirection: "column" as const, height: "auto" as const } : {}),
  }]}>
    {options.map((option, index) => {
      const selected = value === option.value;
      const outer = vertical ? 24 : 20;
      return <Segment key={option.value} value={option.value} label={option.label}
        accessibilityLabel={option.accessibilityLabel} labelStyle={option.labelStyle}
        selected={selected} disabled={disabled}
        expressive={expressive} vertical={vertical} height={visualHeight}
        first={index === 0} last={index === options.length - 1} outer={outer}
        palette={palette} motion={motion} onSelect={select} />;
    })}
  </View>;
  return <View onLayout={(event) => {
    const nextWidth = event.nativeEvent.layout.width;
    setWidth((current) => (current === nextWidth ? current : nextWidth));
  }} style={{ minHeight: 48, justifyContent: "center" }}>
    {orientation === "auto" || horizontalScroll ? <SegmentMeasures options={options} onMeasure={measure} /> : null}
    {horizontalScroll ? <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {group}
    </ScrollView> : group}
  </View>;
}

/** Invisible per-label measuring pass for auto orientation. Memoized so a
 * selection change re-renders the group without re-rendering every hidden
 * label. Options are compared by content, so callers that rebuild an inline
 * array still skip the pass when the labels and styles are unchanged. */
const SegmentMeasures = React.memo(function SegmentMeasures({ options, onMeasure }: {
  options: readonly { value: string; label: string; labelStyle?: TextStyle }[];
  onMeasure: (value: string, width: number) => void;
}) {
  return <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants"
    style={{ position: "absolute", left: 0, right: 0, opacity: 0 }}>
    {options.map((option) => <Text key={option.value} variant="labelLarge" numberOfLines={1}
      style={[{ alignSelf: "flex-start" }, option.labelStyle]} onLayout={(event) =>
        onMeasure(option.value, Math.ceil(event.nativeEvent.layout.width) + 1)}>{option.label}</Text>)}
  </View>;
}, function measureOptionsEqual(previous, next) {
  if (previous.onMeasure !== next.onMeasure || previous.options.length !== next.options.length) return false;
  return previous.options.every((option, index) => {
    const other = next.options[index];
    return other != null && option.value === other.value && option.label === other.label
      && option.labelStyle === other.labelStyle;
  });
});
const styles = StyleSheet.create({
   scroll: { marginHorizontal: -8 },
   scrollContent: { flexGrow: 1, padding: 8 },
   group: { flexDirection: "row", minHeight: 48 },
   option: { flex: 1, minWidth: 48, minHeight: 48, justifyContent: "center" },
   visual: { alignSelf: "stretch", height: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
});
