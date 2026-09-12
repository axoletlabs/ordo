/**
 * Overlay scrollbar: a 2px ink mark in the gutter, no track.
 *
 * Ordo is line-driven (hairline separators, no chrome). A full-height rail
 * next to a chunky pill read as an OS widget; this matches the dividers
 * instead, and the thumb is driven on the UI thread so it doesn't stutter.
 */
import React, { useCallback, useEffect, useRef } from "react";
import {
  Platform,
  StyleSheet,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { useFloatingDockMetrics } from "../../hooks/use-floating-dock-metrics";
import {
  SCROLLBAR_EDGE_INSET,
  SCROLLBAR_END_INSET,
  SCROLLBAR_IDLE_MS,
  SCROLLBAR_MIN_THUMB,
  SCROLLBAR_THUMB_WIDTH,
  scrollBarBottomInset,
  scrollbarColors,
  type ScrollBarInsets,
} from "../../theme/scrollbar";
import { radius, timing } from "../../theme/tokens";

export type { ScrollBarInsets };

/** Overlay track insets: flush with the first row, stop just above the dock. */
export function useScrollBarInsets(): Required<ScrollBarInsets> {
  const { listOverlayClearance } = useFloatingDockMetrics();
  return {
    top: 0,
    bottom: scrollBarBottomInset(listOverlayClearance),
  };
}

export function chainHandlers<Args extends unknown[]>(
  ...handlers: Array<((...args: Args) => void) | undefined>
) {
  return (...args: Args) => {
    for (const handler of handlers) handler?.(...args);
  };
}

export function useVerticalScrollBar(insets?: ScrollBarInsets) {
  const { palette } = useTheme();
  const colors = scrollbarColors(palette);
  const topInset = insets?.top ?? SCROLLBAR_END_INSET;
  const bottomInset = insets?.bottom ?? SCROLLBAR_END_INSET;
  const viewport = useSharedValue(1);
  const content = useSharedValue(1);
  const offset = useSharedValue(0);
  const opacity = useSharedValue(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => {
    opacity.value = withTiming(1, { duration: timing.normal });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      opacity.value = withTiming(0, { duration: timing.slow });
    }, SCROLLBAR_IDLE_MS);
  }, [opacity]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewport.value = event.nativeEvent.layout.height;
    },
    [viewport],
  );

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      content.value = height;
    },
    [content],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      offset.value = contentOffset.y;
      viewport.value = layoutMeasurement.height;
      content.value = contentSize.height;
      if (contentSize.height > layoutMeasurement.height + 1) reveal();
    },
    [content, offset, reveal, viewport],
  );

  const overlay =
    Platform.OS === "web" ? null : (
      <ScrollBarOverlay
        viewport={viewport}
        content={content}
        offset={offset}
        opacity={opacity}
        thumbColor={colors.thumb}
        topInset={topInset}
        bottomInset={bottomInset}
      />
    );

  return {
    onLayout,
    onContentSizeChange,
    onScroll,
    overlay,
    hideNativeIndicator: true,
    indicatorStyle: palette.mode === "dark" ? ("white" as const) : ("black" as const),
  };
}

function ScrollBarOverlay({
  viewport,
  content,
  offset,
  opacity,
  thumbColor,
  topInset,
  bottomInset,
}: {
  viewport: SharedValue<number>;
  content: SharedValue<number>;
  offset: SharedValue<number>;
  opacity: SharedValue<number>;
  thumbColor: string;
  topInset: number;
  bottomInset: number;
}) {
  const top = useSharedValue(topInset);
  const bottom = useSharedValue(bottomInset);
  top.value = topInset;
  bottom.value = bottomInset;

  const thumbStyle = useAnimatedStyle(() => {
    const track = Math.max(0, viewport.value - top.value - bottom.value);
    const view = viewport.value;
    const size = content.value;
    if (size <= view + 1 || track <= 0) {
      return { opacity: 0, height: 0, transform: [{ translateY: 0 }] };
    }
    const thumb = Math.min(track, Math.max(SCROLLBAR_MIN_THUMB, (view / size) * track));
    const maxScroll = size - view;
    const travel = Math.max(0, track - thumb);
    const clamped = Math.min(maxScroll, Math.max(0, offset.value));
    const y = maxScroll <= 0 ? 0 : (clamped / maxScroll) * travel;
    return {
      opacity: opacity.value,
      height: thumb,
      transform: [{ translateY: y }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[styles.thumb, { top: topInset, backgroundColor: thumbColor }, thumbStyle]}
    />
  );
}

export function splitScrollLayoutStyle(style: StyleProp<ViewStyle>): {
  wrapper: ViewStyle | undefined;
  inner: StyleProp<ViewStyle>;
} {
  const flat = StyleSheet.flatten(style);
  if (!flat) return { wrapper: undefined, inner: style };
  const {
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    height,
    minHeight,
    maxHeight,
    width,
    alignSelf,
    ...inner
  } = flat;
  const wrapper: ViewStyle = {};
  if (flex != null) wrapper.flex = flex;
  if (flexGrow != null) wrapper.flexGrow = flexGrow;
  if (flexShrink != null) wrapper.flexShrink = flexShrink;
  if (flexBasis != null) wrapper.flexBasis = flexBasis;
  if (height != null) wrapper.height = height;
  if (minHeight != null) wrapper.minHeight = minHeight;
  if (maxHeight != null) wrapper.maxHeight = maxHeight;
  if (width != null) wrapper.width = width;
  if (alignSelf != null) wrapper.alignSelf = alignSelf;
  return {
    wrapper: Object.keys(wrapper).length > 0 ? wrapper : undefined,
    inner: inner as ViewStyle,
  };
}

const styles = StyleSheet.create({
  thumb: {
    position: "absolute",
    top: SCROLLBAR_END_INSET,
    right: SCROLLBAR_EDGE_INSET,
    width: SCROLLBAR_THUMB_WIDTH,
    borderRadius: radius.full,
    zIndex: 4,
  },
});
