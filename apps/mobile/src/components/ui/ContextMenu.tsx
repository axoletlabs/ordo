/**
 * Anchored floating context menu — sits next to the control that opened it
 * instead of centering a dimmed dialog over the screen.
 */
import React from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import type { Palette } from "../../theme/theme";
import { haptics } from "../../lib/haptics";
import { radius, spacing } from "../../theme/tokens";
import {
  CONTEXT_MENU_ITEM_HEIGHT,
  CONTEXT_MENU_MAX_WIDTH,
  CONTEXT_MENU_MIN_WIDTH,
  CONTEXT_MENU_PADDING_Y,
  CONTEXT_MENU_SCREEN_PAD,
  estimateMenuHeight,
  placeContextMenu,
  type MenuAlign,
  type MenuAnchor,
} from "./context-menu-layout";

export type { MenuAlign, MenuAnchor } from "./context-menu-layout";
export { measureAnchor } from "./context-menu-layout";

export function menuHoverFill(palette: Palette): string {
  return palette.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(21,20,15,0.06)";
}

export function contextMenuSurface(palette: Palette): string {
  return palette.mode === "dark" ? palette.surfaceSecondary : palette.surfaceElevated;
}

export interface ContextMenuProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  anchor?: MenuAnchor | null;
  align?: MenuAlign;
  width?: number;
  style?: StyleProp<ViewStyle>;
}

export function ContextMenu({
  visible,
  onDismiss,
  children,
  anchor,
  align = "end",
  width,
  style,
}: ContextMenuProps) {
  const { palette, shadows } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const progress = React.useRef(new Animated.Value(0)).current;
  const items = React.Children.toArray(children);
  const [measured, setMeasured] = React.useState({ width: 0, height: 0 });

  const maxWidth = Math.min(width ?? CONTEXT_MENU_MAX_WIDTH, windowWidth - CONTEXT_MENU_SCREEN_PAD * 2);
  const menuWidth = measured.width > 0 ? measured.width : Math.min(width ?? CONTEXT_MENU_MIN_WIDTH, maxWidth);
  const menuHeight = measured.height > 0 ? measured.height : estimateMenuHeight(Math.max(items.length, 1));

  const fallbackAnchor: MenuAnchor = {
    x: windowWidth - insets.right - spacing[48],
    y: insets.top + spacing[48],
    width: spacing[32],
    height: spacing[32],
  };
  const placed = placeContextMenu({
    anchor: anchor ?? fallbackAnchor,
    menuWidth,
    menuHeight,
    windowWidth,
    windowHeight,
    insets,
    align,
  });

  React.useEffect(() => {
    if (!visible) {
      setMeasured({ width: 0, height: 0 });
      return;
    }
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
  }, [progress, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View accessibilityViewIsModal style={styles.root}>
        <Pressable
          accessibilityLabel="Dismiss menu"
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
        />
        <Animated.View
          accessibilityRole="menu"
          onLayout={(event) => {
            const next = event.nativeEvent.layout;
            setMeasured((current) =>
              Math.abs(current.width - next.width) < 0.5 && Math.abs(current.height - next.height) < 0.5
                ? current
                : { width: next.width, height: next.height },
            );
          }}
          style={[
            styles.menu,
            {
              left: placed.left,
              top: placed.top,
              minWidth: width ?? CONTEXT_MENU_MIN_WIDTH,
              maxWidth,
              maxHeight: placed.maxHeight,
              backgroundColor: contextMenuSurface(palette),
              borderColor: palette.borderStrong,
              ...shadows.level3,
              opacity: progress,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              ],
            },
            style,
          ]}
        >
            {children}
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
  onPress,
  accessibilityLabel,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: "danger";
  trailing?: React.ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { palette } = useTheme();
  const color = tone === "danger" ? palette.danger : palette.text;
  const hover = menuHoverFill(palette);
  const [hovered, setHovered] = React.useState(false);

  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={accessibilityLabel ?? label}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => {
        haptics.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.item,
        (hovered || pressed) && { backgroundColor: hover },
        Platform.OS === "web" ? styles.itemWeb : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={20} color={color} /> : null}
      <Text variant="body" style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  menu: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius["3xl"],
    paddingVertical: CONTEXT_MENU_PADDING_Y,
    paddingHorizontal: spacing[4],
  },
  item: {
    minHeight: CONTEXT_MENU_ITEM_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingHorizontal: spacing[12],
    borderRadius: radius.lg,
  },
  itemWeb: {
    cursor: "pointer",
    // RN web: fade the hover fill instead of snapping.
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  } as ViewStyle,
  label: { flex: 1, flexShrink: 1 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
});
