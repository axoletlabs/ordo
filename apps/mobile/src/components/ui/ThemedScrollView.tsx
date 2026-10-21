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
  type NativeScrollEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { type FlashListProps } from "@shopify/flash-list";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { LinearTransition, runOnJS, useAnimatedScrollHandler, useComposedEventHandler,
  type ScrollHandlerProcessed } from "react-native-reanimated";
import { useMaterialMotion } from "../../theme/material-motion";
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
import { useOverlayBlocked } from "./overlay-host";
import { shouldReportScroll } from "../../lib/scroll-report";
import { useSceneReady } from "../../hooks/use-scene-ready";
import { BookmarkListSkeleton } from "./BookmarkListSkeleton";

export type ThemedScrollViewProps = ScrollViewProps & {
  scrollBarInsets?: ScrollBarInsets;
  /** UI-thread scroll animation. JS bookkeeping is sampled, not frame-critical. */
  animatedScrollHandler?: ScrollHandlerProcessed<Record<string, unknown>>;
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
  Platform.OS === "web" ? { transform: "none", overscrollBehavior: "contain" } as ViewStyle : null;

/** Web already blocks the background with inert isolation and a full-viewport
 * scrim; subscribing there re-rendered every scroller/list when a popup opened.
 * RN Web's scrollDisabled only sets overflow/touch-action: programmatic scroll
 * still worked and keyboard scrolling needs focus, which inert removes.
 * Native keeps scrollEnabled because it has no inherited inert. Mirrors the
 * platform-split hook in ScrollBar. */
const useNativeOverlayBlocked = Platform.OS === "web" ? () => false : useOverlayBlocked;

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
      animatedScrollHandler,
      ...props
    },
    ref,
  ) {
    const bar = useVerticalScrollBar(scrollBarInsets);
    const blocked = useNativeOverlayBlocked();
    // Plain browser scrollers don't need Reanimated event registration. Keep
    // those hooks below a separate component, off every dialog's mount path.
    const animated = Platform.OS !== "web" || !!animatedScrollHandler;
    const VerticalScrollView = animated ? AnimatedVerticalScrollView : ScrollView;
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
          scrollEnabled={!blocked && props.scrollEnabled !== false}
        />
      );
    }

    const fill = scrollViewShouldFill(wrapper);
    return (
      <View
        style={[styles.host, fill ? styles.fill : null, wrapper]}
        onLayout={chainHandlers(Platform.OS === "web" ? undefined : bar.onLayout, onLayout)}
      >
        <VerticalScrollView
          ref={ref}
          {...props}
          scrollEnabled={!blocked && props.scrollEnabled !== false}
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
          {...(animated ? { animatedScrollHandler, updateScroll: bar.updateScroll, onScrollActivity: bar.onScrollActivity } : {})}
          onScroll={onScroll}
          onContentSizeChange={chainHandlers(Platform.OS === "web" ? undefined : bar.onContentSizeChange, onContentSizeChange)}
          scrollEventThrottle={scrollEventThrottle ?? 16}
        />
        {bar.overlay}
      </View>
    );
  },
);

type ScrollBridgeProps = {
  animatedScrollHandler?: ScrollHandlerProcessed<Record<string, unknown>>;
  updateScroll?: (event: NativeScrollEvent) => void;
  onScrollActivity?: NonNullable<ScrollViewProps["onScroll"]>;
  onScroll?: ScrollViewProps["onScroll"];
};

function useSampledScrollBridge({ animatedScrollHandler, updateScroll, onScrollActivity, onScroll }: ScrollBridgeProps) {
  const reportScroll = React.useCallback((event: NativeScrollEvent) => {
    const synthetic = { nativeEvent: event } as Parameters<NonNullable<ScrollViewProps["onScroll"]>>[0];
    onScrollActivity?.(synthetic);
    onScroll?.(synthetic);
  }, [onScrollActivity, onScroll]);
  const bridge = useAnimatedScrollHandler({
    onScroll: (event, context: { lastReport?: number }) => {
      updateScroll?.(event);
      const now = Date.now();
      if (!shouldReportScroll(now, context.lastReport)) return;
      context.lastReport = now;
      runOnJS(reportScroll)(event);
    },
    onEndDrag: (event) => { runOnJS(reportScroll)(event); },
    onMomentumEnd: (event) => { runOnJS(reportScroll)(event); },
  });
  return useComposedEventHandler([animatedScrollHandler ?? null, bridge]);
}

const AnimatedVerticalScrollView = React.forwardRef<ScrollView, ScrollViewProps & ScrollBridgeProps>(
  function AnimatedVerticalScrollView({ animatedScrollHandler, updateScroll, onScrollActivity, onScroll, ...props }, ref) {
  const composed = useSampledScrollBridge({ animatedScrollHandler, updateScroll, onScrollActivity, onScroll });
  return <Animated.ScrollView ref={ref} {...props} onScroll={composed} />;
});

// Ordinary lists need event worklets, not an extra animated layout cell per row.
const EventAnimatedFlatList = Animated.createAnimatedComponent(FlatList) as unknown as typeof FlatList;
const NativeAnimatedFlatList = React.forwardRef(function NativeAnimatedFlatList<T>(
  { updateScroll, onScrollActivity, onScroll, animateChanges, ...props }: FlatListProps<T> & ScrollBridgeProps & { animateChanges?: boolean },
  ref: React.ForwardedRef<FlatList<T>>,
) {
  const composed = useSampledScrollBridge({ updateScroll, onScrollActivity, onScroll });
  const List = (animateChanges ? Animated.FlatList : EventAnimatedFlatList) as typeof FlatList;
  // createAnimatedComponent accepts processed handlers at runtime; the generic
  // FlatList cast above preserves item/ref inference, not Reanimated's prop type.
  return <List ref={ref} {...props} onScroll={composed as unknown as ScrollViewProps["onScroll"]} />;
}) as <T>(props: FlatListProps<T> & ScrollBridgeProps & { animateChanges?: boolean; ref?: React.Ref<FlatList<T>> }) => React.ReactElement;

/**
 * Bookmark lists are FlatLists. FlashList v2 cached 200px slots and
 * duplicate page rows showed as gaps; a fetch-next also set `isFetching`,
 * which spun the native refresh bar at the bottom in a loop.
 */
export const ThemedFlashList = React.forwardRef(function ThemedFlashList<T>(
  props: ThemedFlashListProps<T>,
  ref: React.ForwardedRef<FlatList<T>>,
) {
  const sceneReady = useSceneReady();
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

  if (!sceneReady) return <View style={styles.fill}><BookmarkListSkeleton /></View>;
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
  const blocked = useNativeOverlayBlocked();
  const { wrapper, inner } = splitScrollLayoutStyle(style);
  const customRefresh = !refreshControl && !!onRefresh;
  const refresh = useMaterialRefresh(!!refreshing, onRefresh, customRefresh && !blocked && rest.scrollEnabled !== false);
  const fill = wrapper?.flex == null && wrapper?.maxHeight == null && wrapper?.height == null;
  const itemCount = Array.isArray(data) ? data.length : data == null ? 0 : 1;
  const motion = useMaterialMotion();
  const transition = React.useMemo(() => LinearTransition.springify().mass(motion.fast.mass)
    .stiffness(motion.fast.stiffness).damping(motion.fast.damping), [motion.fast]);
  const List = (Platform.OS !== "web" ? NativeAnimatedFlatList : animateChanges ? Animated.FlatList : FlatList) as typeof FlatList;

  const list = (
    <List
      ref={ref}
      data={data}
      {...rest}
      scrollEnabled={!blocked && rest.scrollEnabled !== false}
      {...(animateChanges && !motion.reducedMotion ? { itemLayoutAnimation: transition } : {})}
      {...nativeScrollBarProps}
      showsVerticalScrollIndicator={
        Platform.OS === "web" ? (showsVerticalScrollIndicator ?? true) : false
      }
      indicatorStyle={bar.indicatorStyle}
      refreshControl={refreshControl}
      removeClippedSubviews={false}
      contentContainerStyle={[
        { flexGrow: itemCount === 0 ? 1 : 0 },
        contentContainerStyle,
      ]}
      style={[fill ? styles.fill : null, inner, webNoContainingTransform]}
      {...(Platform.OS !== "web" ? { updateScroll: bar.updateScroll, onScrollActivity: bar.onScrollActivity, animateChanges } : {})}
      onScroll={chainHandlers(customRefresh ? refresh.onScroll : undefined, onScroll)}
      onTouchStart={chainHandlers(Platform.OS === "web" ? refresh.onTouchStart : undefined, onTouchStart)}
      onTouchMove={chainHandlers(Platform.OS === "web" ? refresh.onTouchMove : undefined, onTouchMove)}
      onTouchEnd={chainHandlers(Platform.OS === "web" ? refresh.onTouchEnd : undefined, onTouchEnd)}
      onTouchCancel={chainHandlers(Platform.OS === "web" ? refresh.onTouchCancel : undefined, onTouchCancel)}
      onScrollEndDrag={chainHandlers(Platform.OS === "web" ? refresh.onScrollEndDrag : undefined, onScrollEndDrag)}
      onContentSizeChange={chainHandlers(Platform.OS === "web" ? undefined : bar.onContentSizeChange, onContentSizeChange)}
      scrollEventThrottle={scrollEventThrottle ?? 16}
    />
  );
  return (
    <View
      style={[styles.host, fill ? styles.fill : null, wrapper]}
      onLayout={chainHandlers(Platform.OS === "web" ? undefined : bar.onLayout, onLayout)}
    >
      {customRefresh && refresh.gesture ? <GestureDetector gesture={refresh.gesture}>{list}</GestureDetector> : list}
      {bar.overlay}
      {customRefresh ? <RefreshHud dy={refresh.dy} refreshing={!!refreshing} /> : null}
    </View>
  );
}) as <T>(props: ThemedFlatListProps<T> & { ref?: React.Ref<FlatList<T>> }) => React.ReactElement;

const styles = StyleSheet.create({
  host: { position: "relative", overflow: "visible" },
  fill: { flex: 1 },
});
