/**
 * Anchored floating context menu: sits beside its trigger instead of a
 * centered, dimmed dialog. Items use a rounded hover fill rather than a
 * press-scale, matching a lightweight desktop/web menu.
 */
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { OverlayPortal } from "./overlay-host";
import { useTheme } from "../../theme/ThemeProvider";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { haptics } from "../../lib/haptics";
import {
  CONTEXT_MENU_WIDTH,
  isMenuAnchorRect,
  menuHoverFill,
  placeMenu,
  type MenuAnchorRect,
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
  const lastPlacement = React.useRef<ReturnType<typeof placeMenu> | null>(null);
  const lastChildren = React.useRef(children);
  if (visible) lastChildren.current = children;

  const menuWidth = Math.min(width, Math.max(160, windowWidth - spacing[32]));
  // Keep the last real placement and items through dismiss. Callers clear
  // `anchor` and empty `children` on close; the old fallback sat at the top
  // of the screen, so a fading scrap of the menu flashed there.
  if (visible && isMenuAnchorRect(anchor)) {
    lastPlacement.current = placeMenu({
      anchor,
      menuWidth,
      menuHeight: contentHeight || 240,
      windowWidth,
      windowHeight,
      insets,
    });
  }
  const placed = lastPlacement.current;
  const fromY = placed?.placement === "above" ? 6 : -6;

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
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
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={contentHeight > placed.maxHeight}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: placed.maxHeight }}
          >
            <View
              onLayout={(event) => {
                if (!visible) return;
                const next = event.nativeEvent.layout.height;
                if (next > 0 && Math.abs(next - contentHeight) > 0.5) setContentHeight(next);
              }}
            >
              {visible ? children : lastChildren.current}
            </View>
          </ScrollView>
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
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: "danger";
  trailing?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const [hovered, setHovered] = React.useState(false);
  const color = tone === "danger" ? palette.danger : palette.text;
  const highlight = menuHoverFill(palette.mode, true);

  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => {
        if (disabled) return;
        haptics.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.item,
        Platform.OS === "web" ? styles.itemWeb : null,
        disabled && styles.itemDisabled,
        (pressed || hovered) && !disabled ? { backgroundColor: highlight } : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <Text variant="body" style={[styles.itemLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={18} color={palette.accent} /> : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
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
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingHorizontal: spacing[12],
    borderRadius: radius.lg,
  },
  itemWeb: {
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  } as ViewStyle,
  itemDisabled: { opacity: 0.45 },
  itemLabel: { flex: 1, minWidth: 0 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    flexShrink: 0,
  },
});
