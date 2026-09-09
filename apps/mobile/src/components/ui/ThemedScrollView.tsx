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
  type LayoutChangeEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { FlashList, type FlashListProps } from "@shopify/flash-list";
import Animated, { LinearTransition } from "react-native-reanimated";
import {
  chainHandlers,
  splitScrollLayoutStyle,
  useVerticalScrollBar,
} from "./ScrollBar";
import { scrollViewShouldFill } from "../../theme/scrollbar";
import { springs } from "../../theme/tokens";

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

export function ThemedFlashList<T>(props: FlashListProps<T>) {
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

  return (
    <View style={[styles.host, styles.fill, wrapper]} onLayout={chainHandlers(bar.onLayout, onLayout)}>
      <FlashList
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
}

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

const SEARCH_LAYOUT = LinearTransition.springify()
  .damping(springs.snappy.damping)
  .stiffness(springs.snappy.stiffness)
  .mass(springs.snappy.mass);

function SearchCellRenderer({
  onLayout,
  children,
  style,
}: {
  onLayout?: (event: LayoutChangeEvent) => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View layout={SEARCH_LAYOUT} onLayout={onLayout} style={style} collapsable={false}>
      {children}
    </Animated.View>
  );
}

/**
 * FlatList whose rows slide when the data order changes. Windowed, no enter/exit
 * fades — those were what made search hitch and skip the motion.
 */
export function ThemedAnimatedFlatList<T>(
  props: Omit<FlatListProps<T>, "CellRendererComponent">,
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
        windowSize={7}
        maxToRenderPerBatch={8}
        initialNumToRender={12}
        updateCellsBatchingPeriod={50}
        {...rest}
        {...nativeScrollBarProps}
        CellRendererComponent={SearchCellRenderer}
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
}

const styles = StyleSheet.create({
  host: { position: "relative" },
  fill: { flex: 1 },
});
