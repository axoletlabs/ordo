/**
 * Anchored floating context menu: sits beside its trigger instead of a
 * centered, dimmed dialog. Items use a rounded hover fill rather than a
 * press-scale, matching a lightweight desktop/web menu.
 */
import React from "react";
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
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
  const progress = React.useRef(new Animated.Value(0)).current;
  const [contentHeight, setContentHeight] = React.useState(0);
  const hasSize = contentHeight > 0;

  React.useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    Keyboard.dismiss();
  }, [progress, visible]);

  React.useEffect(() => {
    if (!visible || !hasSize) return;
    progress.setValue(0);
    requestAnimationFrame(() => {
      Animated.spring(progress, {
        toValue: 1,
        damping: 22,
        stiffness: 280,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    });
  }, [hasSize, progress, visible]);

  const menuWidth = Math.min(width, Math.max(160, windowWidth - spacing[32]));
  const placed = isMenuAnchorRect(anchor)
    ? placeMenu({
        anchor,
        menuWidth,
        menuHeight: contentHeight || 240,
        windowWidth,
        windowHeight,
        insets,
      })
    : {
        left: Math.max(spacing[16], windowWidth - menuWidth - spacing[16]),
        top: insets.top + spacing[16],
        placement: "below" as const,
        maxHeight: Math.max(0, windowHeight - insets.top - insets.bottom - spacing[32]),
      };
  const fromY = placed.placement === "below" ? -6 : 6;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View accessibilityViewIsModal style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss menu"
          style={StyleSheet.absoluteFill}
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
              opacity: hasSize ? progress : 0,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
              ],
            },
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
                const next = event.nativeEvent.layout.height;
                if (next > 0 && Math.abs(next - contentHeight) > 0.5) setContentHeight(next);
              }}
            >
              {children}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
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
  modalRoot: { flex: 1 },
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
