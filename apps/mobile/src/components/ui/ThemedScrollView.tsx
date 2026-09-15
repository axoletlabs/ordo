/**
 * ScrollView / FlashList / FlatList wrappers that hide the unthemed OS
 * indicator and draw a palette-aware overlay on native. Web keeps the native
 * bar, which ThemeProvider restyles via CSS.
 */
import React from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type FlatListProps,
  type ScrollViewProps,
} from "react-native";
import { type FlashListProps } from "@shopify/flash-list";
import {
  chainHandlers,
  splitScrollLayoutStyle,
  useScrollBarInsets,
  useVerticalScrollBar,
  type ScrollBarInsets,
} from "./ScrollBar";
import { scrollViewShouldFill } from "../../theme/scrollbar";
import { useTheme } from "../../theme/ThemeProvider";
import { LIST_END_REACHED_THRESHOLD } from "../../lib/list-pagination";

/** Native pull-to-refresh with the branded coral-on-chip colors. */
function useThemedRefreshControl(
  refreshing: boolean | null | undefined,
  onRefresh: (() => void) | null | undefined,
  refreshControl?: React.ReactElement,
) {
  const { palette } = useTheme();
  if (refreshControl) return refreshControl;
  if (refreshing == null && onRefresh == null) return undefined;
  return (
    <RefreshControl
      refreshing={!!refreshing}
      onRefresh={onRefresh ?? undefined}
      tintColor={palette.accent}
      colors={[palette.accent]}
      progressBackgroundColor={palette.surfaceElevated}
    />
  );
}

export type ThemedScrollViewProps = ScrollViewProps & {
  scrollBarInsets?: ScrollBarInsets;
};

export type ThemedFlashListProps<T> = FlashListProps<T> & {
  scrollBarInsets?: ScrollBarInsets;
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

/**
 * Bookmark lists are FlatLists. FlashList v2 cached 200px slots and
 * duplicate page rows showed as gaps; a fetch-next also set `isFetching`,
 * which spun the native refresh bar at the bottom in a loop.
 */
export function ThemedFlashList<T>(props: ThemedFlashListProps<T>) {
  const chromeInsets = useScrollBarInsets();
  const {
    getItemType: _getItemType,
    drawDistance: _drawDistance,
    maintainVisibleContentPosition: _maintainVisibleContentPosition,
    overrideItemLayout: _overrideItemLayout,
    onCommitLayoutEffect: _onCommitLayoutEffect,
    onLoad: _onLoad,
    masonry: _masonry,
    optimizeItemArrangement: _optimizeItemArrangement,
    overrideProps: _overrideProps,
    stickyHeaderConfig: _stickyHeaderConfig,
    onChangeStickyIndex: _onChangeStickyIndex,
    maxItemsInRecyclePool: _maxItemsInRecyclePool,
    onStartReached: _onStartReached,
    onStartReachedThreshold: _onStartReachedThreshold,
    initialScrollIndexParams: _initialScrollIndexParams,
    scrollBarInsets,
    ...flatListProps
  } = props;

  return (
    <ThemedFlatList
      removeClippedSubviews={false}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      onEndReachedThreshold={LIST_END_REACHED_THRESHOLD}
      {...(flatListProps as ThemedFlatListProps<T>)}
      scrollBarInsets={scrollBarInsets ?? chromeInsets}
    />
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
    scrollBarInsets,
    contentContainerStyle,
    data,
    ...rest
  } = props;
  const bar = useVerticalScrollBar(scrollBarInsets);
  const { wrapper, inner } = splitScrollLayoutStyle(style);
  const themedRefresh = useThemedRefreshControl(refreshing, onRefresh, refreshControl);
  const fill = wrapper?.flex == null && wrapper?.maxHeight == null && wrapper?.height == null;
  const itemCount = Array.isArray(data) ? data.length : data == null ? 0 : 1;

  return (
    <View
      style={[styles.host, fill ? styles.fill : null, wrapper]}
      onLayout={chainHandlers(bar.onLayout, onLayout)}
    >
      <FlatList
        ref={ref}
        data={data}
        {...rest}
        {...nativeScrollBarProps}
        showsVerticalScrollIndicator={
          Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
        }
        indicatorStyle={bar.indicatorStyle}
        refreshControl={themedRefresh}
        removeClippedSubviews={false}
        contentContainerStyle={[
          { flexGrow: itemCount === 0 ? 1 : 0 },
          contentContainerStyle,
        ]}
        style={[fill ? styles.fill : null, inner]}
        onScroll={chainHandlers(bar.onScroll, onScroll)}
        onContentSizeChange={chainHandlers(bar.onContentSizeChange, onContentSizeChange)}
        scrollEventThrottle={scrollEventThrottle ?? 16}
      />
      {bar.overlay}
    </View>
  );
}) as <T>(props: ThemedFlatListProps<T> & { ref?: React.Ref<FlatList<T>> }) => React.ReactElement;

const styles = StyleSheet.create({
  host: { position: "relative", overflow: "visible" },
  fill: { flex: 1 },
});
