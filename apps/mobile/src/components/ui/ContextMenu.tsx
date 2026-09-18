/**
 * Anchored floating context menu: sits beside its trigger instead of a
 * centered, dimmed dialog. Rows fill the panel (no inset, no inter-row gap)
 * so hover is full-bleed; comfort comes from each row's inner padding.
 */
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon } from "./PinIcon";
import { Spinner } from "./Spinner";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { OverlayPortal } from "./overlay-host";
import { ThemedScrollView } from "./ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import { haptics } from "../../lib/haptics";
import {
  CONTEXT_MENU_WIDTH,
  isMenuAnchorRect,
  menuHoverFill,
  placeMenu,
  type MenuAnchorRect,
  type MenuPlacement,
} from "../../lib/menu-anchor";
import { layout, radius, spacing } from "../../theme/tokens";

export type { MenuAnchorRect };

export function ContextMenu({
  visible,
  onDismiss,
  anchor,
  children,
  width = CONTEXT_MENU_WIDTH,
  backdrop = true,
  preferredPlacement,
  estimatedHeight = 200,
  sessionKey,
}: {
  visible: boolean;
  onDismiss: () => void;
  anchor: MenuAnchorRect | null;
  children: React.ReactNode;
  width?: number;
  /** When false, taps pass through so OS text selection stays alive. */
  backdrop?: boolean;
  preferredPlacement?: MenuPlacement["placement"];
  estimatedHeight?: number;
  /**
   * Keep the panel where it first landed across hide/show in the same
   * overlay session (Remind, Custom, Back). A new key starts a fresh place.
   */
  sessionKey?: string | number | null;
}) {
  const { palette, shadows } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hideAndDismiss = React.useCallback(() => {
    if (backdrop) dismissKeyboard();
    onDismiss();
  }, [backdrop, onDismiss]);
  const { rendered, progress } = useOverlayPresence(visible, hideAndDismiss, {
    dismissKeyboard: backdrop,
  });
  const [contentHeight, setContentHeight] = React.useState(0);
  const contentHeightRef = React.useRef(0);
  const lastPlacement = React.useRef<MenuPlacement | null>(null);
  const placementLock = React.useRef<MenuPlacement | null>(null);
  const sessionSide = React.useRef<MenuPlacement["placement"] | null>(null);
  const wasVisibleRef = React.useRef(visible);
  const layoutKeyRef = React.useRef("");
  const lastChildren = React.useRef(children);
  if (visible) lastChildren.current = children;
  const sessionKeyRef = React.useRef(sessionKey);
  if (sessionKeyRef.current !== sessionKey) {
    sessionKeyRef.current = sessionKey;
    contentHeightRef.current = 0;
    placementLock.current = null;
    sessionSide.current = null;
    if (contentHeight !== 0) setContentHeight(0);
  }
  // New open: drop the previous row's measured height so a leftover
  // delete-confirm size cannot flash below, then jump above — unless this
  // is the same overlay session coming back from a nested page.
  if (visible && !wasVisibleRef.current) {
    const continueSession = sessionKey != null && placementLock.current != null;
    if (!continueSession) {
      contentHeightRef.current = 0;
      placementLock.current = null;
      sessionSide.current = null;
      if (contentHeight !== 0) setContentHeight(0);
    }
  }
  wasVisibleRef.current = visible;

  const menuWidth = Math.min(width, Math.max(160, windowWidth - spacing[32]));
  const layoutKey = [
    windowWidth,
    windowHeight,
    menuWidth,
    isMenuAnchorRect(anchor) ? `${anchor.x}:${anchor.y}:${anchor.width}:${anchor.height}` : "",
  ].join("|");
  if (layoutKeyRef.current !== layoutKey) {
    layoutKeyRef.current = layoutKey;
    placementLock.current = null;
  }
  const measuredHeight = contentHeightRef.current;
  // Keep the last real placement and items through dismiss. Callers clear
  // `anchor` and empty `children` on close; the old fallback sat at the top
  // of the screen, so a fading scrap of the menu flashed there.
  // After the first measured layout, freeze that origin so delete confirm
  // shrinks in place instead of jumping when the panel gets shorter.
  if (visible && isMenuAnchorRect(anchor)) {
    if (placementLock.current) {
      lastPlacement.current = placementLock.current;
    } else {
      lastPlacement.current = placeMenu({
        anchor,
        menuWidth,
        menuHeight: measuredHeight || estimatedHeight,
        windowWidth,
        windowHeight,
        insets,
        preferredPlacement: sessionSide.current ?? preferredPlacement,
      });
      if (measuredHeight > 0) {
        placementLock.current = lastPlacement.current;
        sessionSide.current = lastPlacement.current.placement;
      }
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
      <View
        accessibilityViewIsModal={visible && backdrop}
        pointerEvents={visible ? (backdrop ? "auto" : "box-none") : "none"}
        style={styles.modalRoot}
      >
        {backdrop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss menu"
            style={StyleSheet.absoluteFill}
            pointerEvents={visible ? "auto" : "none"}
            onPressIn={dismissKeyboard}
            onPress={hideAndDismiss}
          />
        ) : null}
        <Animated.View
          accessibilityRole="menu"
          pointerEvents="auto"
          style={[
            styles.menu,
            {
              left: placed.left,
              top: placed.top,
              width: menuWidth,
              maxHeight: placed.maxHeight,
              backgroundColor: palette.mode === "dark" ? palette.surfaceSecondary : palette.surfaceElevated,
              borderColor: palette.outline,
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
                if (!visible || placementLock.current) return;
                const next = event.nativeEvent.layout.height;
                if (next <= 0 || Math.abs(next - contentHeightRef.current) < 1) return;
                contentHeightRef.current = next;
                setContentHeight(next);
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

/** Helper copy inside a context menu, aligned to the item column. */
export function ContextMenuNote({
  children,
  tone = "secondary",
}: {
  children: React.ReactNode;
  tone?: "secondary" | "tertiary" | "danger";
}) {
  return (
    <Text variant="footnote" color={tone} align="center" style={styles.note}>
      {children}
    </Text>
  );
}

export function ContextMenuItem({
  icon,
  label,
  detail,
  tone,
  trailing,
  selected,
  disabled,
  busy,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Trailing local time or similar meta, same row as the label. */
  detail?: string;
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
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
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
      {icon ? <AppIcon name={icon} size={16} color={color} /> : <View style={styles.iconSlot} />}
      <Text variant="body" style={[styles.itemLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {busy ? (
        <Spinner size="sm" color={color} style={styles.itemSide} />
      ) : selected ? (
        <Ionicons name="checkmark" size={16} color={palette.accent} style={styles.itemSide} />
      ) : trailing ? (
        <View style={[styles.trailing, styles.itemSide]}>{trailing}</View>
      ) : detail ? (
        <Text variant="monoSmall" color="tertiary" numberOfLines={1} style={styles.itemSide}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalRoot: { ...StyleSheet.absoluteFill },
  menu: {
    position: "absolute",
    overflow: "hidden",
    padding: layout.overlayMenuPadding,
    borderWidth: 1,
    borderRadius: radius["3xl"],
  },
  note: {
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  item: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[10],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  itemSide: { alignSelf: "center", flexShrink: 0 },
  itemWeb: {
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  } as ViewStyle,
  itemDisabled: { opacity: 0.45 },
  iconSlot: { width: 16, height: 16 },
  itemLabel: { flex: 1, minWidth: 0 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    flexShrink: 0,
  },
});
