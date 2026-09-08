/**
 * Floating action button faithful to ordo-archive: 48px coral circle, white icon.
 */
import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "./PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { layout, spacing } from "../../theme/tokens";

export interface FABProps {
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: (anchor: MenuAnchorRect) => void;
  onLongPress?: (anchor: MenuAnchorRect) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  bottom?: number;
  right?: number;
  maxContentWidth?: number;
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

export function FAB({
  icon = "add",
  onPress,
  onLongPress,
  accessibilityLabel = "Create",
  accessibilityHint,
  testID,
  bottom = spacing[20],
  right: rightOverride,
  maxContentWidth = layout.maxLibraryWidth,
}: FABProps) {
  const { palette, shadows } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const anchorRef = React.useRef<View>(null);
  const right = Math.max(
    insets.right + spacing[20],
    rightOverride ?? (width - Math.min(width, maxContentWidth)) / 2 + spacing[20],
  );
  const emit = (handler?: (anchor: MenuAnchorRect) => void, event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (!handler) return;
    measureAnchor(anchorRef.current, handler, event);
  };
  return (
    <View
      ref={anchorRef}
      collapsable={false}
      style={[styles.fab, { backgroundColor: palette.accent, bottom, right }, shadows.level2]}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={styles.fabHit}
        scaleTo={0.9}
        onPress={(event) => emit(onPress, event)}
        onLongPress={onLongPress ? (event) => emit(onLongPress, event) : undefined}
      >
        <Ionicons name={icon} size={24} color={palette.onAccent} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, width: "100%", alignSelf: "center" },
  fab: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  fabHit: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
