/**
 * Anchored floating context menu: sits beside its trigger instead of a
 * centered dialog. Inset state layers stay inside the rounded menu surface.
 */
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
  type PressableProps,
} from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMaterialMotion } from "../../theme/material-motion";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { AppIcon } from "./PinIcon";
import { Spinner } from "./Spinner";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { PressableScale } from "./PressableScale";
import { OverlayPortal } from "./overlay-host";
import { ThemedScrollView } from "./ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useOverlayFocus } from "../../hooks/use-overlay-focus";
import { dismissKeyboard, useKeyboardViewportHeight } from "../../hooks/use-keyboard-visible";
import { haptics } from "../../lib/haptics";
import {
  CONTEXT_MENU_WIDTH,
  isMenuAnchorRect,
  placeMenu,
  type MenuAnchorRect,
  type MenuPlacement,
} from "../../lib/menu-anchor";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { layout, radius, spacing } from "../../theme/tokens";

export type { MenuAnchorRect };

export interface ContextMenuProps {
  visible: boolean;
  onDismiss: () => void;
  anchor: MenuAnchorRect | null;
  children: React.ReactNode;
  width?: number;
  backdrop?: boolean;
  preferredPlacement?: MenuPlacement["placement"];
  estimatedHeight?: number;
  sessionKey?: string | number | null;
  scrollBody?: boolean;
  keyboardDismiss?: boolean;
  /** Nested pages share the first page's viewport and transition in place. */
  pageKey?: string;
}

export function ContextMenu(props: ContextMenuProps) {
  const [activated, setActivated] = React.useState(props.visible);
  if (props.visible && !activated) setActivated(true);
  return activated ? <ContextMenuSurface {...props} /> : null;
}

function ContextMenuSurface({
  visible,
  onDismiss,
  anchor,
  children,
  width = CONTEXT_MENU_WIDTH,
  backdrop = true,
  preferredPlacement,
  estimatedHeight = 200,
  sessionKey,
  scrollBody = true,
  keyboardDismiss = true,
  pageKey,
}: ContextMenuProps) {
  const { palette, shadows, expressive } = useTheme();
  const { width: windowWidth, height } = useWindowDimensions();
  const windowHeight = useKeyboardViewportHeight(height, visible);
  const insets = useSafeAreaInsets();
  const hideAndDismiss = React.useCallback(() => {
    if (backdrop && keyboardDismiss) dismissKeyboard();
    onDismiss();
  }, [backdrop, keyboardDismiss, onDismiss]);
  const { rendered, progress, spatial } = useOverlayPresence(visible, hideAndDismiss, {
    dismissKeyboard: backdrop && keyboardDismiss,
  });
  const menuRef = useOverlayFocus(visible && rendered && backdrop, hideAndDismiss, "menu");
  const [contentHeight, setContentHeight] = React.useState(0);
  const contentHeightRef = React.useRef(0);
  const retainedHeight = React.useRef(0);
  const pageProgress = useSharedValue(1);
  const motion = useMaterialMotion();
  const lastPage = React.useRef(pageKey);
  React.useLayoutEffect(() => {
    if (!visible || pageKey === lastPage.current) return;
    lastPage.current = pageKey;
    pageProgress.value = motion.reducedMotion ? 1 : 0;
    pageProgress.value = withTiming(1, { duration: motion.reducedMotion ? 0 : 160 });
  }, [visible, pageKey, pageProgress, motion.reducedMotion]);
  const pageStyle = useAnimatedStyle(() => ({
    opacity: pageProgress.value,
    ...(Platform.OS !== "web" ? { transform: [{ translateX: (1 - pageProgress.value) * 8 }] } : {}),
  }));
  const lastPlacement = React.useRef<MenuPlacement | null>(null);
  const placementLock = React.useRef<MenuPlacement | null>(null);
  const sessionSide = React.useRef<MenuPlacement["placement"] | null>(null);
  const wasVisibleRef = React.useRef(visible);
  const layoutKeyRef = React.useRef("");
  const lastChildren = React.useRef(children);
  if (visible) lastChildren.current = children;
  const sessionKeyRef = React.useRef(sessionKey);
  if (visible && sessionKeyRef.current !== sessionKey) {
    sessionKeyRef.current = sessionKey;
    contentHeightRef.current = 0;
    retainedHeight.current = 0;
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
      retainedHeight.current = 0;
      placementLock.current = null;
      sessionSide.current = null;
      if (contentHeight !== 0) setContentHeight(0);
    }
  }
  wasVisibleRef.current = visible;

  const menuWidth = Math.min(width, Math.max(160, windowWidth - spacing[32]));
  const menuPadding = spacing[8];
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
        menuHeight: (measuredHeight || estimatedHeight) + menuPadding * 2,
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
  const pageHeight = pageKey != null && retainedHeight.current > 0 && placed
    ? Math.min(retainedHeight.current, placed.maxHeight - menuPadding * 2) : undefined;
  const fromY = placed?.placement === "above" ? 6 : -6;
  const awaitingMeasure = visible && measuredHeight <= 0;

  const menuStyle = useAnimatedStyle(() => ({
    opacity: awaitingMeasure ? 0 : progress.value,
    transform: [{ translateY: interpolate(spatial.value, [0, 1], [fromY * 2, 0]) }],
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
            onPressIn={keyboardDismiss ? dismissKeyboard : undefined}
            onPress={hideAndDismiss}
          />
        ) : null}
        <Animated.View
          ref={menuRef}
          accessibilityRole="menu"
          aria-hidden={!visible}
          {...(Platform.OS === "web" ? { tabIndex: -1, dataSet: { materialOverlay: visible ? "true" : "false", menuPage: pageKey ?? "" } } : {})}
          pointerEvents="auto"
          style={[
            styles.menu,
            {
              left: placed.left,
              top: placed.top,
              width: menuWidth,
              maxHeight: placed.maxHeight,
              height: pageHeight != null ? pageHeight + menuPadding * 2 : undefined,
              backgroundColor: palette.surfaceContainerHigh,
              borderRadius: expressive ? radius.xl : radius.xs,
              paddingVertical: menuPadding,
              ...shadows.level2,
            },
            menuStyle,
          ]}
        >
            <View
              collapsable={false}
              style={{ height: pageHeight, maxHeight: Math.max(48, placed.maxHeight - menuPadding * 2), flexShrink: 1 }}
              onLayout={(event) => {
                if (!visible || placementLock.current) return;
                const actual = event.nativeEvent.layout.height;
                const next = pageKey != null ? retainedHeight.current || Math.max(144, actual) : actual;
                if (next <= 0 || Math.abs(next - contentHeightRef.current) < 1) return;
                contentHeightRef.current = next;
                if (pageKey != null && retainedHeight.current === 0) retainedHeight.current = next;
                setContentHeight(next);
              }}
            >
              <Animated.View style={[{ flexShrink: 1, ...(pageHeight != null ? { flex: 1 } : {}) }, pageStyle]}>
              {scrollBody ? <ThemedScrollView bounces={false} keyboardShouldPersistTaps="handled" style={pageHeight != null ? { flex: 1 } : { maxHeight: Math.max(48, placed.maxHeight - menuPadding * 2) }}>
                {visible ? children : lastChildren.current}
              </ThemedScrollView> : visible ? children : lastChildren.current}
              </Animated.View>
            </View>
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
  selectionRole,
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
  selectionRole?: "menuitemradio" | "menuitemcheckbox";
}) {
  const { palette, expressive } = useTheme();
  const color = tone === "danger" ? palette.error : selected ? palette.onSecondaryContainer : palette.onSurface;
  const inactive = disabled || busy;

  return (
    <PressableScale
      accessibilityRole={selectionRole === "menuitemradio" ? "radio" : selectionRole === "menuitemcheckbox" ? "checkbox" : "menuitem"}
      {...(Platform.OS === "web" ? { role: (selectionRole ?? "menuitem") as PressableProps["role"] } : null)}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: !!inactive, selected: !!selected, busy: !!busy, ...(selectionRole ? { checked: !!selected } : {}) }}
      aria-disabled={!!inactive}
      aria-busy={!!busy}
      disabled={inactive}
      stateLayerColor={color}
      focusOnlyVisible
      onHoverIn={Platform.OS === "web" && !inactive ? (event) => (event.currentTarget as unknown as HTMLElement)?.focus() : undefined}
      shape={expressive ? { rest: selected ? radius.md : radius.sm, pressed: selected ? radius.md : radius.sm } : undefined}
      onPress={() => {
        if (inactive) return;
        haptics.light();
        onPress();
      }}
      style={[
        styles.item,
        Platform.OS === "web" ? styles.itemWeb : null,
        inactive && styles.itemDisabled,
        { backgroundColor: selected ? palette.secondaryContainer : "transparent" },
        { borderRadius: expressive ? radius.md : radius.xs, marginHorizontal: spacing[8] },
      ]}
    >
      <View style={styles.iconSlot}>
        {icon ? <AppIcon name={icon} size={24} color={color} /> : null}
      </View>
      <Text variant="bodyLarge" style={[styles.itemLabel, { color }]} numberOfLines={2}>
        {label}
      </Text>
      {busy ? (
        <Spinner size="sm" color={color} style={styles.itemSide} />
      ) : selected ? (
        <Ionicons
          name="checkmark"
          size={16}
           color={palette.onSecondaryContainer}
          style={[styles.itemSide, iconGlyphStyle(16)]}
        />
      ) : trailing ? (
        <View style={[styles.trailing, styles.itemSide]}>{trailing}</View>
      ) : detail ? (
        <Text variant="monoSmall" color="tertiary" numberOfLines={1} style={[styles.itemSide, styles.itemDetail]}>
          {detail}
        </Text>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  modalRoot: { ...StyleSheet.absoluteFill },
  menu: {
    position: "absolute",
    overflow: "hidden",
    padding: layout.overlayMenuPadding,
    borderWidth: 0,
    borderRadius: radius["3xl"],
  },
  note: {
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  item: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  itemSide: { alignSelf: "center", flexShrink: 0 },
  itemWeb: {
    cursor: "pointer",
  } as ViewStyle,
  itemDisabled: { opacity: 0.45 },
  iconSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { flex: 1, minWidth: 0, includeFontPadding: false },
  itemDetail: { includeFontPadding: false },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    flexShrink: 0,
  },
});
