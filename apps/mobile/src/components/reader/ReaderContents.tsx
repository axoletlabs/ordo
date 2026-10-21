import React, { startTransition, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, View, useWindowDimensions, type ListRenderItemInfo, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SharedValue } from "react-native-reanimated";
import type { ArticleHeading } from "./ArticleHtml";
import { FAB, FABLayer } from "../ui/FAB";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { ListPressable } from "../ui/ListPressable";
import { Text } from "../ui/Text";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import type { WebPressKeyEvent } from "../ui/pressable-web";
import { useTheme } from "../../theme/ThemeProvider";
import { listCorners, listPosition } from "../../theme/list-shape";
import { layout, radius, spacing } from "../../theme/tokens";
import type { ReaderWorkScheduler } from "./reader-work";
import { useAnimationActivity } from "../../hooks/use-animation-activity";

export interface ReaderContentsHandle { open: () => void; prepare: () => void }
interface ReaderContentsProps {
  headings: readonly ArticleHeading[];
  onSelect: (id: string) => void;
  expansion: { spatial: SharedValue<number>; effects: SharedValue<number> };
  embedded: boolean;
  bottom: number;
  sceneWidth: number;
  workScheduler: ReaderWorkScheduler;
}

const keyExtractor = (heading: ArticleHeading) => heading.id;
const renderScrollComponent = (props: ScrollViewProps) => <ThemedScrollView {...props} />;

/** Contents is navigation chrome, not article state. Opening/closing must not
 * reconcile the reader or mount a whole article's worth of heading controls. */
export const ReaderContents = React.memo(React.forwardRef<ReaderContentsHandle, ReaderContentsProps>(function ReaderContents({
  headings, onSelect, expansion, embedded, bottom, sceneWidth, workScheduler,
}, ref) {
  const [visible, setVisible] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [articleReady, setArticleReady] = useState(false);
  const active = useAnimationActivity();
  const pendingSelection = useRef<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  useEffect(() => {
    // Do not mount a second native tree during article startup. Once content
    // settles, prepare only a viewport of rows at interruptible idle priority.
    // An earlier tap still opens immediately and retains that prepared surface.
    if (!active || !articleReady || prepared) return;
    return workScheduler.schedule(() => startTransition(() => setPrepared(true)));
  }, [active, articleReady, prepared, workScheduler]);
  const prepare = useCallback(() => setArticleReady(true), []);
  const open = useCallback(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") triggerRef.current = document.activeElement as HTMLElement | null;
    pendingSelection.current = null;
    setPrepared(true);
    setVisible(true);
  }, []);
  const close = useCallback(() => setVisible(false), []);
  useImperativeHandle(ref, () => ({ open, prepare }), [open, prepare]);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { palette, expressive } = useTheme();
  const list = useRef<FlatList<ArticleHeading>>(null);
  const [initialIndex, setInitialIndex] = useState(0);
  const resetList = useCallback(() => {
    setInitialIndex(0);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  const commitSelection = useCallback(() => {
    const id = pendingSelection.current;
    pendingSelection.current = null;
    if (id) selectRef.current(id);
  }, []);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocus = useRef<{ index: number; root: HTMLElement; attempts: number } | null>(null);
  const focusHeading = useCallback(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const row = pending.root.querySelector<HTMLElement>(`[data-contents-index="${pending.index}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      row.focus({ preventScroll: true });
      pendingFocus.current = null;
      return;
    }
    if (pending.attempts++ >= 10) { pendingFocus.current = null; return; }
    focusTimer.current = setTimeout(focusHeading, 60);
  }, []);
  useEffect(() => {
    if (!visible) {
      pendingFocus.current = null;
      if (focusTimer.current) clearTimeout(focusTimer.current);
    }
    return () => { if (focusTimer.current) clearTimeout(focusTimer.current); };
  }, [visible]);
  const onKeyDown = useCallback((event: WebPressKeyEvent, index: number) => {
    if (Platform.OS !== "web") return;
    const target = event.key === "ArrowDown" ? Math.min(headings.length - 1, index + 1)
      : event.key === "ArrowUp" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? headings.length - 1 : -1;
    if (target < 0) return;
    const root = (event.currentTarget as HTMLElement)?.closest<HTMLElement>('[role="dialog"]');
    if (!root) return;
    event.preventDefault();
    if (focusTimer.current) clearTimeout(focusTimer.current);
    pendingFocus.current = { index: target, root, attempts: 0 };
    // FlatList cannot scroll directly to a distant, unmeasured variable-height
    // row. Start a new bounded window there instead of mounting every row on
    // the way to End/Home. Ordinary arrow navigation keeps the current list.
    if (!root.querySelector(`[data-contents-index="${target}"]`)) setInitialIndex(target);
    focusHeading();
  }, [focusHeading, headings.length]);
  const onScrollToIndexFailed = useCallback(({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    // Initial scrolling can precede a two-line cell's first measurement.
    list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
  }, []);
  const baseLevel = useMemo(() => headings.reduce((level, heading) => Math.min(level, heading.level), 6), [headings]);
  const select = useCallback((id: string) => {
    pendingSelection.current = id;
    close();
  }, [close]);
  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<ArticleHeading>) => (
    <ListPressable
      style={[
        styles.row,
        { paddingLeft: spacing[16] + (item.level - baseLevel) * spacing[16] },
        expressive ? {
          ...listCorners(listPosition(index, headings.length), false),
          backgroundColor: palette.surfaceContainerLow,
          marginBottom: spacing[2],
        } : null,
      ]}
      onPress={() => select(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Go to ${item.text}`}
      dataSet={Platform.OS === "web" ? { contentsIndex: String(index) } : undefined}
      onKeyDown={(event) => onKeyDown(event, index)}
    >
      <Text variant={item.level === 1 ? "bodyStrong" : "body"} numberOfLines={2}>{item.text}</Text>
    </ListPressable>
  ), [baseLevel, expressive, headings.length, onKeyDown, palette.surfaceContainerLow, select]);
  const listHeight = Math.min(360, (height - insets.top - insets.bottom) * 0.45, headings.length * (expressive ? 50 : 48));

  return <>
    {/* Keep the trigger mounted for focus restoration and stable scroll clearance. */}
    <FABLayer maxWidth={layout.maxReaderWidth}>
      <FAB icon="list-outline" label="Contents" expansion={expansion}
        accessibilityLabel="Table of contents" accessibilityHint="Jump to a section in this article."
        anchored={false} onPress={open} maxContentWidth={layout.maxReaderWidth}
        alignTo={embedded ? "parent" : "scene"} bottom={bottom} />
    </FABLayer>
    <FloatingPanel visible={visible} onDismiss={close} onExiting={commitSelection} onExited={resetList} triggerRef={triggerRef}
      maxWidth={Math.min(416, sceneWidth - spacing[32])} scrollBody={false} keepMounted={prepared}>
      <PanelHeader title="Contents" titleVariant="titleLarge" onClose={close} />
      <View style={{ height: listHeight, maxHeight: listHeight, flexShrink: 1 }}>
        <FlatList key={initialIndex} ref={list} data={headings} renderItem={renderItem} keyExtractor={keyExtractor}
          renderScrollComponent={renderScrollComponent} style={{ flex: 1 }} initialScrollIndex={initialIndex}
          initialNumToRender={8} maxToRenderPerBatch={4} windowSize={2}
          onScrollToIndexFailed={onScrollToIndexFailed}
          keyboardShouldPersistTaps="handled" />
      </View>
    </FloatingPanel>
  </>;
}));

const styles = StyleSheet.create({
  row: {
    minHeight: 48, justifyContent: "center", paddingHorizontal: spacing[16], paddingVertical: spacing[8],
    borderRadius: radius.xs, overflow: "hidden",
  },
});
