/**
 * Overlay scrollbar that sits in the viewport gutter instead of on top of
 * row actions / the FAB, and that uses the active palette (including AMOLED).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import {
  SCROLLBAR_EDGE_INSET,
  SCROLLBAR_END_INSET,
  SCROLLBAR_IDLE_MS,
  SCROLLBAR_THUMB_WIDTH,
  scrollbarColors,
  scrollThumbLayout,
} from "../../theme/scrollbar";
import { timing } from "../../theme/tokens";

export function chainHandlers<Args extends unknown[]>(
  ...handlers: Array<((...args: Args) => void) | undefined>
) {
  return (...args: Args) => {
    for (const handler of handlers) handler?.(...args);
  };
}

interface ScrollMetrics {
  viewport: number;
  content: number;
  offset: number;
}

export function useVerticalScrollBar() {
  const { palette } = useTheme();
  const colors = scrollbarColors(palette);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    viewport: 1,
    content: 1,
    offset: 0,
  });
  const opacity = useSharedValue(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => {
    opacity.value = withTiming(1, { duration: timing.fast });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      opacity.value = withTiming(0, { duration: timing.normal });
    }, SCROLLBAR_IDLE_MS);
  }, [opacity]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setMetrics((current) =>
      Math.abs(current.viewport - height) < 0.5 ? current : { ...current, viewport: height },
    );
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setMetrics((current) =>
      Math.abs(current.content - height) < 0.5 ? current : { ...current, content: height },
    );
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      setMetrics({
        viewport: layoutMeasurement.height,
        content: contentSize.height,
        offset: contentOffset.y,
      });
      if (contentSize.height > layoutMeasurement.height + 1) reveal();
    },
    [reveal],
  );

  const overlay =
    Platform.OS === "web" ? null : (
      <ScrollBarOverlay metrics={metrics} opacity={opacity} colors={colors} />
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
  metrics,
  opacity,
  colors,
}: {
  metrics: ScrollMetrics;
  opacity: Animated.SharedValue<number>;
  colors: { thumb: string; track: string };
}) {
  const track = Math.max(0, metrics.viewport - SCROLLBAR_END_INSET * 2);
  const layout = scrollThumbLayout(metrics.viewport, metrics.content, metrics.offset, track);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!layout) return null;

  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { backgroundColor: colors.track }, fade]}
    >
      <View
        style={[
          styles.thumb,
          {
            backgroundColor: colors.thumb,
            height: layout.thumb,
            transform: [{ translateY: layout.y }],
          },
        ]}
      />
    </Animated.View>
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
  track: {
    position: "absolute",
    top: SCROLLBAR_END_INSET,
    bottom: SCROLLBAR_END_INSET,
    right: SCROLLBAR_EDGE_INSET,
    width: SCROLLBAR_THUMB_WIDTH,
    borderRadius: 99,
    overflow: "hidden",
    zIndex: 4,
  },
  thumb: {
    width: SCROLLBAR_THUMB_WIDTH,
    borderRadius: 99,
  },
});
