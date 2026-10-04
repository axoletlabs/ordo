/** Material floating action button, overlaid on the library content. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { useColumnPadding, type ColumnAlign } from "../../hooks/use-scene-column-insets";
import { layout, radius, spacing } from "../../theme/tokens";
import { SELECTION_LONG_PRESS_MS } from "../../hooks/use-selection";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardVisible } from "../../hooks/use-keyboard-visible";
import { useFocusEffect } from "expo-router";
import { useFloatingActions } from "../../store/floating-actions";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";

export interface FABProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  expansion?: { spatial: SharedValue<number>; effects: SharedValue<number> };
  onPress: (anchor: MenuAnchorRect) => void;
  onLongPress?: (anchor: MenuAnchorRect) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  bottom?: number;
  right?: number;
  maxContentWidth?: number;
  /** See `Header` `alignTo`. The embedded reader passes `parent`. */
  alignTo?: ColumnAlign;
}

interface FABLayerProps {
  children: React.ReactNode;
  maxWidth: number;
}

/** Centers an absolute FAB against the current navigation scene, not the window. */
export function FABLayer({ children, maxWidth }: FABLayerProps) {
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={[styles.layer, { maxWidth }]}>
        {children}
      </View>
    </View>
  );
}

/** Overlay the action without reserving a separate row below the list. */
export function FABDock({ children, maxWidth }: FABLayerProps) {
  const keyboard = useKeyboardVisible();
  if (keyboard) return null;
  return <FABLayer maxWidth={maxWidth}>{children}</FABLayer>;
}

export function FAB({
  icon = "add",
  label,
  expansion,
  onPress,
  onLongPress,
  accessibilityLabel = "Create",
  accessibilityHint,
  testID,
  bottom = spacing[20],
  right: rightOverride,
  maxContentWidth = layout.maxLibraryWidth,
  alignTo = "scene",
}: FABProps) {
  const { palette, shadows, expressive } = useTheme();
  const [labelWidth, setLabelWidth] = React.useState(0);
  const expanded = useSharedValue(1);
  const spatial = expansion?.spatial ?? expanded;
  const effects = expansion?.effects ?? expanded;
  const widthStyle = useAnimatedStyle(() => ({
    width: label ? 56 + (labelWidth + spacing[8]) * Math.max(0, spatial.value) : 56,
  }));
  const hitStyle = useAnimatedStyle(() => ({ gap: label ? spacing[8] * Math.max(0, Math.min(1, spatial.value)) : 0 }));
  const labelStyle = useAnimatedStyle(() => ({ width: labelWidth * Math.max(0, spatial.value), opacity: Math.max(0, Math.min(1, effects.value)) }));
  const id = React.useId();
  useFocusEffect(React.useCallback(() => {
    useFloatingActions.getState().add(id);
    return () => useFloatingActions.getState().remove(id);
  }, [id]));
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(maxContentWidth, alignTo);
  const anchorRef = React.useRef<View>(null);
  const right = rightOverride ?? column.right;
  const emit = (handler?: (anchor: MenuAnchorRect) => void, event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (!handler) return;
    measureAnchor(anchorRef.current, handler, event);
  };
  return (
    <Animated.View
      ref={anchorRef}
      collapsable={false}
      style={[styles.fab, { bottom: Math.max(bottom, insets.bottom + spacing[16]), right, borderRadius: expressive ? radius.xl : radius.lg }, shadows.level3, widthStyle]}
    >
      <PressableScale
        animated
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={[styles.fabHit, { width: "100%", overflow: "hidden", backgroundColor: palette.primaryContainer, borderRadius: expressive ? radius.xl : radius.lg, paddingHorizontal: spacing[16] }, hitStyle]}
        stateLayerColor={palette.onPrimaryContainer}
        shape={{ rest: expressive ? radius.xl : radius.lg, pressed: expressive ? radius.md : radius.lg }}
        onPress={(event) => {
          haptics.light();
          emit(onPress, event);
        }}
        onLongPress={onLongPress ? (event) => emit(onLongPress, event) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        <Ionicons name={icon} size={24} color={palette.onPrimaryContainer} />
        {label ? <>
          <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", width: 280, height: 24, opacity: 0 }}>
            <Text variant="labelLarge" numberOfLines={1} style={{ alignSelf: "flex-start" }} onLayout={(event) => setLabelWidth(event.nativeEvent.layout.width)}>{label}</Text>
          </View>
          <Animated.View pointerEvents="none" aria-hidden style={[{ overflow: "hidden" }, labelStyle]}>
            <Text variant="labelLarge" numberOfLines={1} style={{ width: labelWidth, color: palette.onPrimaryContainer }}>{label}</Text>
          </Animated.View>
        </> : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, width: "100%", alignSelf: "center" },
  fab: {
    position: "absolute",
    minWidth: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  fabHit: {
    minWidth: 56,
    height: 56,
    flexDirection: "row",
    gap: spacing[8],
    alignItems: "center",
    justifyContent: "center",
  },
});
