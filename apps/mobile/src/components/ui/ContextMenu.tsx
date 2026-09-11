/**
 * Anchored floating context menu: sits beside its trigger instead of a
 * centered, dimmed dialog. Items use a rounded hover fill rather than a
 * press-scale, matching a lightweight desktop/web menu.
 */
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  ActivityIndicator,
  type ViewStyle,
} from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon } from "./PinIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { OverlayPortal } from "./overlay-host";
import { ThemedScrollView } from "./ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { haptics } from "../../lib/haptics";
import {
  CONTEXT_MENU_WIDTH,
  isMenuAnchorRect,
  menuHoverFill,
  placeMenu,
  type MenuAnchorRect,
  type MenuPlacement,
} from "../../lib/menu-anchor";
import { radius, spacing } from "../../theme/tokens";

export type { MenuAnchorRect };

export function ContextMenu({
  visible,
  onDismiss,
  anchor,
  children,
  width = CONTEXT_MENU_WIDTH,
}: {
  visible: boolean;
  onDismiss: () => void;
  anchor: MenuAnchorRect | null;
  children: React.ReactNode;
  width?: number;
}) {
  const { palette, shadows } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { rendered, progress } = useOverlayPresence(visible, onDismiss);
  const [contentHeight, setContentHeight] = React.useState(0);
  const contentHeightRef = React.useRef(0);
  const heightFrame = React.useRef<number | null>(null);
  const lastPlacement = React.useRef<ReturnType<typeof placeMenu> | null>(null);
  const placementLock = React.useRef<MenuPlacement["placement"] | null>(null);
  const wasVisibleRef = React.useRef(visible);
  const lastChildren = React.useRef(children);
  if (visible) lastChildren.current = children;
  // New open: drop the previous row's measured height and side so a leftover
  // delete-confirm size cannot flash below, then jump above.
  if (visible && !wasVisibleRef.current) {
    if (heightFrame.current != null) {
      cancelAnimationFrame(heightFrame.current);
      heightFrame.current = null;
    }
    contentHeightRef.current = 0;
    placementLock.current = null;
    if (contentHeight !== 0) setContentHeight(0);
  }
  wasVisibleRef.current = visible;
  const measuredHeight = contentHeightRef.current;

  React.useEffect(
    () => () => {
      if (heightFrame.current != null) cancelAnimationFrame(heightFrame.current);
    },
    [],
  );

  const menuWidth = Math.min(width, Math.max(160, windowWidth - spacing[32]));
  // Keep the last real placement and items through dismiss. Callers clear
  // `anchor` and empty `children` on close; the old fallback sat at the top
  // of the screen, so a fading scrap of the menu flashed there.
  if (visible && isMenuAnchorRect(anchor)) {
    lastPlacement.current = placeMenu({
      anchor,
      menuWidth,
      menuHeight: measuredHeight || 240,
      windowWidth,
      windowHeight,
      insets,
      preferredPlacement: placementLock.current ?? undefined,
    });
    if (measuredHeight > 0) {
      placementLock.current = lastPlacement.current.placement;
    }
  }
  const placed = lastPlacement.current;
  const fromY = placed?.placement === "above" ? 6 : -6;
  const awaitingMeasure = visible && measuredHeight <= 0;

  const menuStyle = useAnimatedStyle(() => ({
    opacity: awaitingMeasure ? 0 : progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [fromY, 0]) }],
  }));

  if (!rendered || !placed) return null;

  return (
    <OverlayPortal>
      <View accessibilityViewIsModal style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss menu"
          style={StyleSheet.absoluteFill}
          pointerEvents={visible ? "auto" : "none"}
          onPress={onDismiss}
        />
        <Animated.View
          accessibilityRole="menu"
          style={[
            styles.menu,
            {
              left: placed.left,
              top: placed.top,
              width: menuWidth,
              maxHeight: placed.maxHeight,
              backgroundColor: palette.mode === "dark" ? palette.surfaceSecondary : palette.surfaceElevated,
              borderColor: palette.borderStrong,
              ...shadows.level3,
            },
            menuStyle,
          ]}
        >
          <ThemedScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: placed.maxHeight }}
          >
            <View
              collapsable={false}
              onLayout={(event) => {
                if (!visible) return;
                const next = event.nativeEvent.layout.height;
                if (next <= 0 || Math.abs(next - contentHeightRef.current) < 1) return;
                contentHeightRef.current = next;
                if (heightFrame.current != null) {
                  cancelAnimationFrame(heightFrame.current);
                  heightFrame.current = null;
                }
                const apply = () => {
                  heightFrame.current = null;
                  setContentHeight(next);
                };
                // First paint is hidden until we know the height; apply it
                // now so the menu does not wait an extra frame to appear.
                if (measuredHeight <= 0) {
                  apply();
                  return;
                }
                heightFrame.current = requestAnimationFrame(apply);
              }}
            >
              {visible ? children : lastChildren.current}
            </View>
          </ThemedScrollView>
        </Animated.View>
      </View>
    </OverlayPortal>
  );
}

export function ContextMenuItem({
  icon,
  label,
  tone,
  trailing,
  selected,
  disabled,
  busy,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: "danger";
  trailing?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const [hovered, setHovered] = React.useState(false);
  const color = tone === "danger" ? palette.danger : palette.text;
  const highlight = menuHoverFill(palette.mode, true);
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, selected: !!selected, busy: !!busy }}
      disabled={inactive}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => {
        if (inactive) return;
        haptics.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.item,
        Platform.OS === "web" ? styles.itemWeb : null,
        inactive && styles.itemDisabled,
        (pressed || hovered) && !inactive ? { backgroundColor: highlight } : null,
      ]}
    >
      {icon ? <AppIcon name={icon} size={18} color={color} /> : <View style={styles.iconSlot} />}
      <Text variant="body" style={[styles.itemLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : selected ? (
        <Ionicons name="checkmark" size={18} color={palette.accent} />
      ) : trailing ? (
        <View style={styles.trailing}>{trailing}</View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalRoot: { ...StyleSheet.absoluteFillObject },
  menu: {
    position: "absolute",
    overflow: "hidden",
    padding: spacing[8],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius["3xl"],
  },
  item: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[10],
    borderRadius: radius.lg,
  },
  itemWeb: {
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  } as ViewStyle,
  itemDisabled: { opacity: 0.45 },
  iconSlot: { width: 18, height: 18 },
  itemLabel: { flex: 1, minWidth: 0 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    flexShrink: 0,
  },
});
