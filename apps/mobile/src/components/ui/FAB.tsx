/** Material floating action button, overlaid on the library content. */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
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
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { FAB_DEFAULT_BOTTOM, FAB_SIZE, fabBottomOffset } from "../../lib/fab-layout";

interface FABBaseProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  expansion?: { spatial: SharedValue<number>; effects: SharedValue<number> };
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

export type FABProps = FABBaseProps & (
  | { anchored?: true; onPress: (anchor: MenuAnchorRect) => void }
  | { anchored: false; onPress: () => void }
);

interface FABLayerProps {
  children: React.ReactNode;
  maxWidth: number;
}

const FABVisibilityContext = React.createContext(true);

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
export function FABDock({ children, maxWidth, visible = true }: FABLayerProps & { visible?: boolean }) {
  const keyboard = useKeyboardVisible();
  const shown = visible && !keyboard;
  const motion = useMaterialMotion();
  const position = useSharedValue(Number(shown));
  const opacity = useSharedValue(Number(shown));
  const ref = React.useRef<View>(null);
  React.useLayoutEffect(() => {
    const target = Number(shown);
    position.value = motion.reducedMotion ? target : withSpring(target, motion.spatial);
    opacity.value = motion.reducedMotion ? target : withSpring(target, materialMotion.effects.spatial);
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = !shown;
  }, [shown, motion, opacity, position]);
  const presence = useAnimatedStyle(() => ({ opacity: opacity.value,
    transform: [{ translateY: (1 - position.value) * 24 }] }));
  return <Animated.View ref={ref} pointerEvents={shown ? "box-none" : "none"}
    aria-hidden={!shown} accessibilityElementsHidden={!shown}
    importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
    style={[StyleSheet.absoluteFill, presence]}><FABVisibilityContext.Provider value={shown}>
      <FABLayer maxWidth={maxWidth}>{children}</FABLayer>
    </FABVisibilityContext.Provider></Animated.View>;
}

export function FAB({
  icon = "add",
  label,
  expansion,
  anchored,
  onPress,
  onLongPress,
  accessibilityLabel = "Create",
  accessibilityHint,
  testID,
  bottom = FAB_DEFAULT_BOTTOM,
  right: rightOverride,
  maxContentWidth = layout.maxLibraryWidth,
  alignTo = "scene",
}: FABProps) {
  const { palette, shadows, expressive } = useTheme();
  // A 56dp FAB uses the small 16dp corner in both systems. The increased
  // 20dp corner belongs to the Expressive 80dp medium FAB.
  const corner = radius.lg;
  const [labelWidth, setLabelWidth] = React.useState(0);
  const expanded = useSharedValue(1);
  const spatial = expansion?.spatial ?? expanded;
  const effects = expansion?.effects ?? expanded;
  const widthStyle = useAnimatedStyle(() => ({
    width: label ? FAB_SIZE + (labelWidth + spacing[8]) * Math.max(0, spatial.value) : FAB_SIZE,
  }));
  const hitStyle = useAnimatedStyle(() => ({ gap: label ? spacing[8] * Math.max(0, Math.min(1, spatial.value)) : 0 }));
  const labelStyle = useAnimatedStyle(() => ({ width: labelWidth * Math.max(0, spatial.value), opacity: Math.max(0, Math.min(1, effects.value)) }));
  const id = React.useId();
  const dockVisible = React.useContext(FABVisibilityContext);
  useFocusEffect(React.useCallback(() => {
    if (!dockVisible) return;
    useFloatingActions.getState().add(id);
    return () => useFloatingActions.getState().remove(id);
  }, [id, dockVisible]));
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
      style={[styles.fab, { bottom: fabBottomOffset(insets.bottom, bottom), right, borderRadius: corner }, shadows.level3, widthStyle]}
    >
      <PressableScale
        animated
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={[styles.fabHit, { width: "100%", overflow: "hidden", backgroundColor: palette.primaryContainer, borderRadius: corner, paddingHorizontal: spacing[16] }, hitStyle]}
        stateLayerColor={palette.onPrimaryContainer}
        shape={{ rest: corner, pressed: expressive ? radius.md : corner }}
        onPress={(event) => {
          haptics.light();
          // Centered dialogs don't need window coordinates. In particular,
          // don't wait for a native layout/JS round trip before opening one.
          if (anchored === false) onPress();
          else emit(onPress, event);
        }}
        onLongPress={onLongPress ? (event) => emit(onLongPress, event) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        <Ionicons name={icon} size={24} color={palette.onPrimaryContainer} />
        {label ? <>
          <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", width: 280, height: 24, opacity: 0 }}>
            <Text variant="labelLarge" numberOfLines={1} style={{ alignSelf: "flex-start" }} onLayout={(event) => setLabelWidth(Math.ceil(event.nativeEvent.layout.width) + 1)}>{label}</Text>
          </View>
          <Animated.View pointerEvents="none" aria-hidden style={[{ overflow: "hidden" }, labelStyle]}>
            <Text testID="material-fab-label" variant="labelLarge" numberOfLines={1} style={{ width: labelWidth, color: palette.onPrimaryContainer }}>{label}</Text>
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
    minWidth: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  fabHit: {
    minWidth: FAB_SIZE,
    height: FAB_SIZE,
    flexDirection: "row",
    gap: spacing[8],
    alignItems: "center",
    justifyContent: "center",
  },
});
