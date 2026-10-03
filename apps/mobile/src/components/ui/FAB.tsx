/**
 * Floating action button faithful to ordo-archive: 48px coral circle, white icon.
 */
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

export interface FABProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
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

/** Reserve the action's actual space instead of a blank footer inside the list. */
export function FABDock({ children, maxWidth }: FABLayerProps) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  if (keyboard) return null;
  return <View style={{ height: 72 + Math.max(insets.bottom, spacing[16]), width: "100%" }}>
    <FABLayer maxWidth={maxWidth}>{children}</FABLayer>
  </View>;
}

export function FAB({
  icon = "add",
  label,
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
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(maxContentWidth, alignTo);
  const anchorRef = React.useRef<View>(null);
  const right = rightOverride ?? column.right;
  const emit = (handler?: (anchor: MenuAnchorRect) => void, event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (!handler) return;
    measureAnchor(anchorRef.current, handler, event);
  };
  return (
    <View
      ref={anchorRef}
      collapsable={false}
      style={[styles.fab, { bottom: Math.max(bottom, insets.bottom + spacing[16]), right, borderRadius: expressive ? radius.xl : radius.lg }, shadows.level3]}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={[styles.fabHit, { backgroundColor: palette.primaryContainer, borderRadius: expressive ? radius.xl : radius.lg, paddingHorizontal: label ? spacing[16] : 0 }]}
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
        {label ? <Text variant="labelLarge" style={{ color: palette.onPrimaryContainer }}>{label}</Text> : null}
      </PressableScale>
    </View>
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
