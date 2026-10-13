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
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { type FlashListProps } from "@shopify/flash-list";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useMaterialMotion } from "../../theme/material-motion";
import { useTheme } from "../../theme/ThemeProvider";
import {
  chainHandlers,
  splitScrollLayoutStyle,
  useScrollBarInsets,
  useVerticalScrollBar,
  type ScrollBarInsets,
} from "./ScrollBar";
import { scrollViewShouldFill } from "../../theme/scrollbar";
import { useMaterialRefresh } from "../../hooks/use-material-refresh";
import { RefreshHud } from "./RefreshHud";
import { LIST_END_REACHED_THRESHOLD } from "../../lib/list-pagination";

export type ThemedScrollViewProps = ScrollViewProps & {
  scrollBarInsets?: ScrollBarInsets;
};

export type ThemedFlashListProps<T> = FlashListProps<T> & {
  scrollBarInsets?: ScrollBarInsets;
  animateChanges?: boolean;
  getItemLayout?: FlatListProps<T>["getItemLayout"];
};

export type ThemedFlatListProps<T> = FlatListProps<T> & {
  scrollBarInsets?: ScrollBarInsets;
  animateChanges?: boolean;
};

const nativeScrollBarProps = {
  showsVerticalScrollIndicator: Platform.OS === "web",
  persistentScrollbar: false,
} as const;

// RN-web paints ScrollView with translateZ(0) for a compositor layer. That
// identity transform is still a containing transform, and Chrome then walks
// the caret one extra character on Backspace in nested <input>s (server URL
// fields, overlay forms). Overflow scrolling does not need the layer.
const webNoContainingTransform: StyleProp<ViewStyle> =
  Platform.OS === "web" ? { transform: "none" } : null;

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
          style={[style, webNoContainingTransform]}
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
            webNoContainingTransform,
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
export const ThemedFlashList = React.forwardRef(function ThemedFlashList<T>(
  props: ThemedFlashListProps<T>,
  ref: React.ForwardedRef<FlatList<T>>,
) {
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
      ref={ref}
      animateChanges={false}
      removeClippedSubviews={false}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      // Exact offsets make overscan eligible immediately. Seven screens mounted
      // an entire 40-row folder during navigation; keep one screen on each side.
      windowSize={3}
      updateCellsBatchingPeriod={50}
      onEndReachedThreshold={LIST_END_REACHED_THRESHOLD}
      {...(flatListProps as ThemedFlatListProps<T>)}
      scrollBarInsets={scrollBarInsets ?? chromeInsets}
    />
  );
}) as <T>(props: ThemedFlashListProps<T> & { ref?: React.Ref<FlatList<T>> }) => React.ReactElement;

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
    onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onScrollEndDrag,
    scrollBarInsets,
    contentContainerStyle,
    data,
    animateChanges = false,
    ...rest
  } = props;
  const bar = useVerticalScrollBar(scrollBarInsets);
  const { wrapper, inner } = splitScrollLayoutStyle(style);
  const { palette } = useTheme();
  const managedRefresh = !refreshControl && !!onRefresh;
  const customRefresh = managedRefresh && Platform.OS === "web";
  const refresh = useMaterialRefresh(!!refreshing, onRefresh, customRefresh && rest.scrollEnabled !== false, Platform.OS === "web");
  // Native refresh takes over scrolling and cancels JS touch observation on
  // Android. Keep its themed indicator visible throughout the pull instead of
  // hiding it offscreen and relying on a HUD that stops receiving touch moves.
  const nativeRefresh = managedRefresh && Platform.OS !== "web" ? (
    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh ?? undefined}
      enabled={rest.scrollEnabled !== false}
      colors={[palette.primary]} tintColor={palette.primary}
      progressBackgroundColor={palette.surfaceContainerHigh} />
  ) : undefined;
  const fill = wrapper?.flex == null && wrapper?.maxHeight == null && wrapper?.height == null;
  const itemCount = Array.isArray(data) ? data.length : data == null ? 0 : 1;
  const motion = useMaterialMotion();
  const transition = React.useMemo(() => LinearTransition.springify().mass(motion.fast.mass)
    .stiffness(motion.fast.stiffness).damping(motion.fast.damping), [motion.fast]);
  const List = (animateChanges ? Animated.FlatList : FlatList) as typeof FlatList;

  return (
    <View
      style={[styles.host, fill ? styles.fill : null, wrapper]}
      onLayout={chainHandlers(bar.onLayout, onLayout)}
    >
      {/* Observe touches without replacing the list's native scroll responder. */}
      <List
        ref={ref}
        data={data}
        {...rest}
        {...(animateChanges && !motion.reducedMotion ? { itemLayoutAnimation: transition } : {})}
        {...nativeScrollBarProps}
        showsVerticalScrollIndicator={
          Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
        }
        indicatorStyle={bar.indicatorStyle}
        refreshControl={refreshControl ?? nativeRefresh}
        removeClippedSubviews={false}
        contentContainerStyle={[
          { flexGrow: itemCount === 0 ? 1 : 0 },
          contentContainerStyle,
        ]}
        style={[fill ? styles.fill : null, inner]}
        onScroll={chainHandlers(bar.onScroll, refresh.onScroll, onScroll)}
        onTouchStart={chainHandlers(refresh.onTouchStart, onTouchStart)}
        onTouchMove={chainHandlers(refresh.onTouchMove, onTouchMove)}
        onTouchEnd={chainHandlers(refresh.onTouchEnd, onTouchEnd)}
        onTouchCancel={chainHandlers(refresh.onTouchCancel, onTouchCancel)}
        onScrollEndDrag={chainHandlers(refresh.onScrollEndDrag, onScrollEndDrag)}
        onContentSizeChange={chainHandlers(bar.onContentSizeChange, onContentSizeChange)}
        scrollEventThrottle={scrollEventThrottle ?? 16}
      />
      {bar.overlay}
      {customRefresh ? <RefreshHud dy={refresh.dy} refreshing={!!refreshing} /> : null}
    </View>
  );
}) as <T>(props: ThemedFlatListProps<T> & { ref?: React.Ref<FlatList<T>> }) => React.ReactElement;

const styles = StyleSheet.create({
  host: { position: "relative", overflow: "visible" },
  fill: { flex: 1 },
});
