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
  useScrollBarInsets,
  useVerticalScrollBar,
  type ScrollBarInsets,
} from "./ScrollBar";
import { useBrandedRefresh } from "./RefreshHud";
import { scrollViewShouldFill } from "../../theme/scrollbar";

export type ThemedScrollViewProps = ScrollViewProps & {
  scrollBarInsets?: ScrollBarInsets;
};

export type ThemedFlashListProps<T> = FlashListProps<T> & {
  scrollBarInsets?: ScrollBarInsets;
  /** Reserve the + button's corner. Library lists default to on. */
  scrollBarClearsFab?: boolean;
};

export type ThemedFlatListProps<T> = FlatListProps<T> & {
  scrollBarInsets?: ScrollBarInsets;
};

const nativeScrollBarProps = {
  showsVerticalScrollIndicator: Platform.OS === "web",
  persistentScrollbar: false,
} as const;

export const ThemedScrollView = React.forwardRef<ScrollView, ThemedScrollViewProps>(
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
      scrollBarInsets,
      ...props
    },
    ref,
  ) {
    const bar = useVerticalScrollBar(scrollBarInsets);
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

export function ThemedFlashList<T>(props: ThemedFlashListProps<T>) {
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
    refreshing,
    onRefresh,
    refreshControl,
    onScrollEndDrag,
    scrollBarInsets,
    scrollBarClearsFab = true,
    ...rest
  } = props;
  const chromeInsets = useScrollBarInsets({ fab: scrollBarClearsFab });
  const bar = useVerticalScrollBar(scrollBarInsets ?? chromeInsets);
  const { wrapper, inner } = splitScrollLayoutStyle(style);
  const branded = useBrandedRefresh(refreshing, onRefresh, refreshControl);

  return (
    <View
      collapsable={false}
      style={[styles.host, styles.fill, wrapper]}
      onLayout={chainHandlers(bar.onLayout, onLayout)}
      {...branded.panHandlers}
    >
      <FlashList
        estimatedItemSize={estimatedItemSize}
        drawDistance={drawDistance}
        {...rest}
        {...nativeScrollBarProps}
        showsVerticalScrollIndicator={
          Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
        }
        indicatorStyle={bar.indicatorStyle}
        refreshControl={branded.refreshControl}
        overScrollMode="never"
        style={[styles.fill, inner]}
        onScroll={chainHandlers(branded.onScroll, bar.onScroll, onScroll)}
        onScrollEndDrag={chainHandlers(branded.onScrollEndDrag, onScrollEndDrag)}
        onContentSizeChange={chainHandlers(bar.onContentSizeChange, onContentSizeChange)}
        scrollEventThrottle={scrollEventThrottle ?? 16}
      />
      {bar.overlay}
      {branded.hud}
    </View>
  );
}

export const ThemedFlatList = React.forwardRef(function ThemedFlatList<T>(
  props: ThemedFlatListProps<T>,
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
    refreshing,
    onRefresh,
    refreshControl,
    onScrollEndDrag,
    scrollBarInsets,
    ...rest
  } = props;
  const bar = useVerticalScrollBar(scrollBarInsets);
  const { wrapper, inner } = splitScrollLayoutStyle(style);
  const branded = useBrandedRefresh(refreshing, onRefresh, refreshControl);
  const fill = wrapper?.flex == null && wrapper?.maxHeight == null && wrapper?.height == null;

  return (
    <View
      collapsable={false}
      style={[styles.host, fill ? styles.fill : null, wrapper]}
      onLayout={chainHandlers(bar.onLayout, onLayout)}
      {...branded.panHandlers}
    >
      <FlatList
        ref={ref}
        {...rest}
        {...nativeScrollBarProps}
        showsVerticalScrollIndicator={
          Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
        }
        indicatorStyle={bar.indicatorStyle}
        refreshControl={branded.refreshControl}
        overScrollMode="never"
        style={[fill ? styles.fill : null, inner]}
        onScroll={chainHandlers(branded.onScroll, bar.onScroll, onScroll)}
        onScrollEndDrag={chainHandlers(branded.onScrollEndDrag, onScrollEndDrag)}
        onContentSizeChange={chainHandlers(bar.onContentSizeChange, onContentSizeChange)}
        scrollEventThrottle={scrollEventThrottle ?? 16}
      />
      {bar.overlay}
      {branded.hud}
    </View>
  );
}) as <T>(props: ThemedFlatListProps<T> & { ref?: React.Ref<FlatList<T>> }) => React.ReactElement;

const styles = StyleSheet.create({
  host: { position: "relative", overflow: "visible" },
  fill: { flex: 1 },
});
