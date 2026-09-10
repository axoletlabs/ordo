/**
 * ScrollView / FlashList / FlatList wrappers that hide the unthemed OS
 * indicator and draw a palette-aware overlay on native. Web keeps the native
 * bar, which ThemeProvider restyles via CSS.
 */
import React from "react";
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type FlatListProps,
  type ScrollViewProps,
} from "react-native";
import { FlashList, type FlashListProps } from "@shopify/flash-list";
import {
  chainHandlers,
  splitScrollLayoutStyle,
  useVerticalScrollBar,
} from "./ScrollBar";
import { scrollViewShouldFill } from "../../theme/scrollbar";

const nativeScrollBarProps = {
  showsVerticalScrollIndicator: Platform.OS === "web",
  persistentScrollbar: false,
} as const;

export const ThemedScrollView = React.forwardRef<ScrollView, ScrollViewProps>(
  function ThemedScrollView(
    {
      style,
      horizontal,
      onScroll,
      onLayout,
      onContentSizeChange,
      scrollEventThrottle,
      showsVerticalScrollIndicator,
      indicatorStyle: _indicatorStyle,
      ...props
    },
    ref,
  ) {
    const bar = useVerticalScrollBar();
    const { wrapper, inner } = splitScrollLayoutStyle(style);
    if (horizontal) {
      return (
        <ScrollView
          ref={ref}
          horizontal
          style={style}
          onScroll={onScroll}
          onLayout={onLayout}
          onContentSizeChange={onContentSizeChange}
          scrollEventThrottle={scrollEventThrottle}
          showsVerticalScrollIndicator={false}
          {...props}
        />
      );
    }

    const fill = scrollViewShouldFill(wrapper);
    return (
      <View
        style={[styles.host, fill ? styles.fill : null, wrapper]}
        onLayout={chainHandlers(bar.onLayout, onLayout)}
      >
        <ScrollView
          ref={ref}
          {...props}
          {...nativeScrollBarProps}
          showsVerticalScrollIndicator={
            Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
          }
          indicatorStyle={bar.indicatorStyle}
          style={[
            fill ? styles.fill : null,
            !fill && wrapper?.maxHeight != null ? { maxHeight: wrapper.maxHeight } : null,
            inner,
          ]}
          onScroll={chainHandlers(bar.onScroll, onScroll)}
          onContentSizeChange={chainHandlers(bar.onContentSizeChange, onContentSizeChange)}
          scrollEventThrottle={scrollEventThrottle ?? 16}
        />
        {bar.overlay}
      </View>
    );
  },
);

export const ThemedFlashList = React.forwardRef(function ThemedFlashList<T>(
  props: FlashListProps<T>,
  ref: React.ForwardedRef<FlashList<T>>,
) {
  const {
    style,
    onScroll,
    onLayout,
    onContentSizeChange,
    scrollEventThrottle,
    showsVerticalScrollIndicator,
    indicatorStyle: _indicatorStyle,
    estimatedItemSize = 80,
    drawDistance = 280,
    ...rest
  } = props;
  const bar = useVerticalScrollBar();
  const { wrapper, inner } = splitScrollLayoutStyle(style);

  return (
    <View style={[styles.host, styles.fill, wrapper]} onLayout={chainHandlers(bar.onLayout, onLayout)}>
      <FlashList
        ref={ref}
        estimatedItemSize={estimatedItemSize}
        drawDistance={drawDistance}
        {...rest}
        {...nativeScrollBarProps}
        showsVerticalScrollIndicator={
          Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
        }
        indicatorStyle={bar.indicatorStyle}
        style={[styles.fill, inner]}
        onScroll={chainHandlers(bar.onScroll, onScroll)}
        onContentSizeChange={chainHandlers(bar.onContentSizeChange, onContentSizeChange)}
        scrollEventThrottle={scrollEventThrottle ?? 16}
      />
      {bar.overlay}
    </View>
  );
}) as <T>(props: FlashListProps<T> & { ref?: React.Ref<FlashList<T>> }) => React.ReactElement;

export const ThemedFlatList = React.forwardRef(function ThemedFlatList<T>(
  props: FlatListProps<T>,
  ref: React.ForwardedRef<FlatList<T>>,
) {
  const {
    style,
    onScroll,
    onLayout,
    onContentSizeChange,
    scrollEventThrottle,
    showsVerticalScrollIndicator,
    indicatorStyle: _indicatorStyle,
    ...rest
  } = props;
  const bar = useVerticalScrollBar();
  const { wrapper, inner } = splitScrollLayoutStyle(style);
  const fill = wrapper?.flex == null && wrapper?.maxHeight == null && wrapper?.height == null;

  return (
    <View
      style={[styles.host, fill ? styles.fill : null, wrapper]}
      onLayout={chainHandlers(bar.onLayout, onLayout)}
    >
      <FlatList
        ref={ref}
        {...rest}
        {...nativeScrollBarProps}
        showsVerticalScrollIndicator={
          Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
        }
        indicatorStyle={bar.indicatorStyle}
        style={[fill ? styles.fill : null, inner]}
        onScroll={chainHandlers(bar.onScroll, onScroll)}
        onContentSizeChange={chainHandlers(bar.onContentSizeChange, onContentSizeChange)}
        scrollEventThrottle={scrollEventThrottle ?? 16}
      />
      {bar.overlay}
    </View>
  );
}) as <T>(props: FlatListProps<T> & { ref?: React.Ref<FlatList<T>> }) => React.ReactElement;

const styles = StyleSheet.create({
  host: { position: "relative", overflow: "hidden" },
  fill: { flex: 1 },
});
