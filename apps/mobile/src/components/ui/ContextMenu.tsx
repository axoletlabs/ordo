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
  type LayoutChangeEvent,
  type ViewStyle,
  type PressableProps,
} from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle } from "react-native-reanimated";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { AppIcon } from "./PinIcon";
import { Spinner } from "./Spinner";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ResizeOwnerContext } from "./resize-owner";
import { Text } from "./Text";
import { PressableScale } from "./PressableScale";
import { OverlayPortal } from "./overlay-host";
import { InputFocusScopeContext, useInputFocusScope } from "./input-focus-scope";
import { ThemedScrollView } from "./ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useOverlayFocus } from "../../hooks/use-overlay-focus";
import { useOverlayPage } from "../../hooks/use-overlay-page";
import { useSurfaceSize } from "../../hooks/use-surface-size";
import { useScrimPress } from "../../hooks/use-scrim-press";
import { dismissKeyboard, useKeyboardViewportHeight } from "../../hooks/use-keyboard-visible";
import { haptics } from "../../lib/haptics";
import { listenForMenuOutsideScroll } from "../../lib/menu-outside-scroll";
import {
  CONTEXT_MENU_WIDTH,
  CONTEXT_MENU_EDGE,
  isMenuAnchorRect,
  menuAnchorScrollSnapshot,
  placeMenu,
  type MenuAnchorRect,
  type MenuPlacement,
} from "../../lib/menu-anchor";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { layout, radius, spacing } from "../../theme/tokens";

export type { MenuAnchorRect };

/** Layout should land within a frame or two. If it does not, release the
 * entrance anyway rather than retaining a fully transparent blocking surface. */
const READY_FALLBACK_MS = 200;
// Keep the complete entrance, but reveal in its first useful frame rather than
// spending the beginning easing in from nearly transparent. Dialog/scrim fades
// retain their complementary inOut curve for uniformly dimmed handoffs.
const MENU_ENTRANCE_EASING = Easing.out(Easing.cubic);

export interface ContextMenuProps {
  visible: boolean;
  onDismiss: () => void;
  /** Handoff to a sibling when this menu's exit animation completes. */
  onExited?: () => void;
  /** Handoff as the exit fade begins: the menu is already dismissed (Back,
   * focus, and scrim released), so a sibling can open while it fades. */
  onExiting?: () => void;
  anchor: MenuAnchorRect | null;
  children: React.ReactNode;
  width?: number;
  backdrop?: boolean;
  dismissible?: boolean;
  preferredPlacement?: MenuPlacement["placement"];
  estimatedHeight?: number;
  sessionKey?: string | number | null;
  scrollBody?: boolean;
  keyboardDismiss?: boolean;
  /** Nested pages share an origin, revealing and sizing their incoming contents together. */
  pageKey?: string;
  /** Optional data-aware keyboard navigation for virtualized menu pages. */
  onNavigate?: (key: string) => boolean;
  /** Resume an editing field in the still-open parent form after this picker. */
  returnFocusRef?: { readonly current: unknown };
  /** Bounded reader chrome may measure an inaccessible, non-blocking dormant
   * surface before opening. Exit contents/placement are still retained. */
  keepMounted?: boolean;
}

export function ContextMenu(props: ContextMenuProps) {
  const [activated, setActivated] = React.useState(props.visible);
  if (props.visible && !activated) setActivated(true);
  return activated || props.keepMounted ? <ContextMenuSurface {...props} /> : null;
}

const ContextMenuSurface = React.memo(function ContextMenuSurface({
  visible,
  onDismiss,
  onExited,
  onExiting,
  anchor,
  children,
  width = CONTEXT_MENU_WIDTH,
  backdrop = true,
  dismissible = true,
  preferredPlacement,
  estimatedHeight = 200,
  sessionKey,
  scrollBody = true,
  keyboardDismiss = true,
  pageKey,
  onNavigate,
  returnFocusRef,
  keepMounted = false,
}: ContextMenuProps) {
  const { palette, shadows, expressive } = useTheme();
  const { width: windowWidth, height, fontScale } = useWindowDimensions();
  const windowHeight = useKeyboardViewportHeight(height, visible);
  const insets = useSafeAreaInsets();
  const menuWidth = Math.min(width, Math.max(0, windowWidth - insets.left - insets.right - spacing[32]));
  const menuPadding = spacing[8];
  // Anchor movement does not change the natural body size. Content, viewport,
  // font scale and design mode do: a stale dormant report must never place an
  // opening from the previous article/page/width.
  const measureKey = JSON.stringify([sessionKey, pageKey, menuWidth, windowWidth, windowHeight,
    fontScale, expressive, insets.top, insets.right, insets.bottom, insets.left, scrollBody]);
  const hideAndDismiss = React.useCallback(() => {
    if (!dismissible) return;
    if (backdrop && keyboardDismiss) dismissKeyboard();
    onDismiss();
  }, [backdrop, dismissible, keyboardDismiss, onDismiss]);
  const scrimPress = useScrimPress(visible && backdrop, hideAndDismiss);
  const [contentHeight, setContentHeight] = React.useState(0);
  const inputFocusScope = useInputFocusScope(visible,
    Platform.OS === "web" || contentHeight > 0, visible);
  // A prepared body is measured at its dormant origin. Its entrance must wait
  // for the portal HOST to commit today's anchor/placement, not merely for the
  // publisher to enqueue that update. Otherwise a busy native commit consumes
  // the fade while the surface is still hidden, revealing an opaque jump.
  const presentationKey = JSON.stringify([inputFocusScope.session, measureKey,
    anchor?.x, anchor?.y, anchor?.width, anchor?.height, contentHeight]);
  const [presented, setPresented] = React.useState<string | null>(null);
  const contentHeightRef = React.useRef(0);
  const measuredBody = React.useRef<{ key: string; content: React.ReactNode } | null>(null);
  /** A new session replaced the contents on a visible surface; keep the old
   * height for the current frame but do not lock a placement from it. */
  const measurementStale = React.useRef(false);
  const applyBodyHeight = React.useCallback((height: number) => {
    measurementStale.current = false;
    if (height <= 0 || Math.abs(height - contentHeightRef.current) < 1) return;
    contentHeightRef.current = height;
    setContentHeight(height);
  }, []);
  // A missing layout report (detached portal, unsupported ResizeObserver) must
  // not leave a transparent, input-blocking menu mounted forever. The caller's
  // estimate is only a last resort; a later real measurement still corrects it.
  React.useEffect(() => {
    if (!visible || contentHeight > 0) return;
    const timer = setTimeout(() => applyBodyHeight(estimatedHeight), READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [applyBodyHeight, contentHeight, estimatedHeight, visible]);
  const { rendered, retained, progress, spatial } = useOverlayPresence(visible, hideAndDismiss, {
    dismissKeyboard: backdrop && keyboardDismiss,
    interactive: backdrop,
    ready: contentHeight > 0 && presented === presentationKey,
    entranceEasing: MENU_ENTRANCE_EASING,
    onExited,
    onExiting,
  });
  const dormant = keepMounted && !rendered;
  const menuRef = useOverlayFocus(visible && rendered && backdrop, hideAndDismiss, "menu", dismissible, false, false, onNavigate, returnFocusRef);
  React.useEffect(() => {
    if (!visible || !rendered || !backdrop || Platform.OS !== "web" || typeof document === "undefined") return;
    return listenForMenuOutsideScroll(() => menuRef.current as unknown as HTMLElement | null,
      hideAndDismiss, document, menuAnchorScrollSnapshot(anchor));
  }, [visible, rendered, backdrop, menuRef, hideAndDismiss, anchor]);
  const [measuredPage, setMeasuredPage] = React.useState<string | null>(null);
  const page = useOverlayPage(visible, pageKey ?? "", children, measuredPage === measureKey);
  const lastPlacement = React.useRef<MenuPlacement | null>(null);
  const placementLock = React.useRef<MenuPlacement | null>(null);
  const sessionSide = React.useRef<MenuPlacement["placement"] | null>(null);
  const wasVisibleRef = React.useRef(visible);
  const layoutKeyRef = React.useRef("");
  const lastChildren = React.useRef(children);
  const sessionKeyRef = React.useRef(sessionKey);
  if (visible && sessionKeyRef.current !== sessionKey) {
    sessionKeyRef.current = sessionKey;
    // Keep the committed height while a new session replaces the contents on
    // an already-visible surface; the next layout re-measures it. Resetting to
    // zero here would blank/re-place a menu the user is looking at. Do not lock
    // a placement from that old height before the new report arrives.
    measurementStale.current = true;
    placementLock.current = null;
    sessionSide.current = null;
  }
  // Only reuse a measurement of these exact contents and geometry. An exit
  // tree being mounted does not mean its previous (possibly shorter) page is
  // valid for the next opening.
  if (visible && !wasVisibleRef.current) {
    const preparedHeight = measuredBody.current?.key === measureKey && measuredBody.current.content === children;
    if (measurementStale.current || !preparedHeight) {
      contentHeightRef.current = 0;
      placementLock.current = null;
      sessionSide.current = null;
      if (contentHeight !== 0) setContentHeight(0);
    }
    measurementStale.current = false;
    if (keepMounted && !retained) {
      placementLock.current = null;
      sessionSide.current = null;
    }
  }
  React.useLayoutEffect(() => {
    if (visible) lastChildren.current = page.content;
    if (dormant) sessionKeyRef.current = sessionKey;
    wasVisibleRef.current = visible;
  }, [visible, page.content, dormant, sessionKey]);

  const layoutKey = [
    windowWidth,
    windowHeight,
    menuWidth,
    insets.top, insets.right, insets.bottom, insets.left,
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
      if (measuredHeight > 0 && !measurementStale.current) {
        placementLock.current = lastPlacement.current;
        sessionSide.current = lastPlacement.current.placement;
      }
    }
  }
  // The dormant surface gets a full-height measurement box. It is never a
  // placement lock and never overwrites the real exit placement.
  const placed = dormant ? {
    left: insets.left + CONTEXT_MENU_EDGE,
    top: insets.top + CONTEXT_MENU_EDGE,
    placement: preferredPlacement ?? "below",
    maxHeight: Math.max(0, windowHeight - insets.top - insets.bottom - CONTEXT_MENU_EDGE * 2),
  } : lastPlacement.current;
  const content = dormant ? children : visible ? page.content : lastChildren.current;
  const recordBodyHeight = React.useCallback((height: number) => {
    if (height <= 0) return;
    measuredBody.current = { key: measureKey, content };
    setMeasuredPage(measureKey);
    applyBodyHeight(height);
  }, [applyBodyHeight, content, measureKey]);
  // A taller nested page may scroll, but must not grow below the viewport
  // while the session's origin stays locked.
  const heightLimit = placed ? !dormant && placementLock.current
    ? Math.min(placed.maxHeight, windowHeight - insets.bottom - CONTEXT_MENU_EDGE - placed.top)
    : placed.maxHeight : 0;
  const bodyHeightLimit = Math.max(0, heightLimit - menuPadding * 2);
  const surfaceSize = useSurfaceSize(contentHeight > 0 ? Math.min(heightLimit, contentHeight + menuPadding * 2) : null, {
    active: visible && !dormant,
    geometryKey: `${windowWidth}:${windowHeight}:${fontScale}:${insets.top}:${insets.right}:${insets.bottom}:${insets.left}`,
    width: menuWidth,
  });
  const fromY = placed?.placement === "above" ? 6 : -6;
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(spatial.value, [0, 1], [fromY * 2, 0]) }],
  }));
  if ((!rendered && !keepMounted) || !placed) return null;

  return (
    <OverlayPortal blocking={rendered && backdrop} active={visible}>
      <InputFocusScopeContext.Provider value={inputFocusScope}>
      <View
        accessibilityViewIsModal={visible && backdrop}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={!visible ? "no-hide-descendants" : "auto"}
        aria-hidden={!visible}
        pointerEvents={visible ? (backdrop ? "auto" : "box-none") : "none"}
        style={[styles.modalRoot, Platform.OS === "web" && dormant
          ? { visibility: "hidden" } as unknown as ViewStyle : null]}
      >
        {backdrop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss menu"
            style={StyleSheet.absoluteFill}
            pointerEvents={visible ? "auto" : "none"}
            onPressIn={keyboardDismiss ? dismissKeyboard : undefined}
            {...scrimPress}
            onTouchMove={Platform.OS !== "web" ? hideAndDismiss : undefined}
          />
        ) : null}
        <Animated.View
          ref={menuRef}
          accessibilityRole="menu"
          aria-hidden={!visible}
          {...(Platform.OS === "web" ? { tabIndex: -1, dataSet: { materialOverlay: visible && backdrop ? "true" : "false", menuPage: pageKey ?? "" } } : {})}
          pointerEvents={visible ? "auto" : "none"}
          style={[
            styles.menu,
            {
              left: placed.left,
              top: placed.top,
              width: menuWidth,
              maxHeight: heightLimit,
              backgroundColor: expressive ? palette.surfaceContainerLow : palette.surfaceContainer,
              borderRadius: expressive ? radius.xl : radius.xs,
              paddingVertical: menuPadding,
              ...shadows.level2,
            },
            menuStyle,
            surfaceSize,
          ]}
        >
            <ResizeOwnerContext.Provider value>
            {/* This fixed measurement frame is independent of the animated
                surface height. In Yoga a shrinking ScrollView otherwise reports
                the old viewport as the next page's natural height. */}
            <View pointerEvents="box-none" style={{ position: "absolute", top: menuPadding, width: menuWidth, height: bodyHeightLimit }}>
              <MenuBody
                visible={visible || keepMounted}
                presentationKey={visible && contentHeight > 0 ? presentationKey : null}
                onPresented={setPresented}
                measureKey={measureKey}
                onMeasure={recordBodyHeight}
                style={{ maxHeight: bodyHeightLimit, flexShrink: 0 }}
                onLayout={(event) => {
                  if (!visible && !keepMounted) return;
                  recordBodyHeight(event.nativeEvent.layout.height);
                }}
              >
                <Animated.View style={[{ flexShrink: 1 }, page.style]}>
                {scrollBody ? <ThemedScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: bodyHeightLimit, flexShrink: 1 }}>
                  {content}
                </ThemedScrollView> : content}
                </Animated.View>
              </MenuBody>
            </View>
            </ResizeOwnerContext.Provider>
        </Animated.View>
      </View>
      </InputFocusScopeContext.Provider>
    </OverlayPortal>
  );
});

/** Measures the menu body after it has been committed. Native's `measure()`
 * is asynchronous, so it cannot delay the click task; on web the existing
 * ResizeObserver reports the box after normal
 * layout. Reading `offsetHeight` inside a layout effect forced a synchronous
 * document style/layout recalculation — the dominant cost when a long article
 * sat behind the menu — so placement/entrance wait one non-blocking layout
 * report instead. */
function MenuBody({ visible, measureKey, presentationKey, onPresented, onMeasure, onLayout, style, children }: {
  visible: boolean;
  measureKey?: string | number | null;
  presentationKey: string | null;
  onPresented: (key: string) => void;
  onMeasure: (height: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  style: ViewStyle;
  children: React.ReactNode;
}) {
  const ref = React.useRef<View>(null);
  const measureNative = React.useRef<(() => void) | null>(null);
  React.useLayoutEffect(() => {
    if (presentationKey !== null) onPresented(presentationKey);
  }, [onPresented, presentationKey]);
  React.useLayoutEffect(() => {
    if (!visible) return;
    const node = ref.current;
    if (!node) return;
    if (Platform.OS === "web" && typeof ResizeObserver !== "undefined") {
      // Re-observe on every opening/session, even when a retained element kept
      // its size. RN Web's shared onLayout observer need not report an unchanged
      // box again. This initial async report avoids both a forced layout read
      // and using a previous row's height while waiting for a size change.
      let cancelled = false;
      const observer = new ResizeObserver((entries) => {
        if (cancelled) return;
        const entry = entries.find((entry) => entry.target === (node as unknown as Element));
        if (entry?.contentRect.height) onMeasure(entry.contentRect.height);
      });
      observer.observe(node as unknown as Element);
      return () => { cancelled = true; observer.disconnect(); };
    }
    let cancelled = false;
    let request = 0;
    const measure = () => {
      const token = ++request;
      node.measure((_x, _y, _width, height) => {
        if (!cancelled && token === request && height > 0) onMeasure(height);
      });
    };
    measureNative.current = measure;
    measure();
    return () => { cancelled = true; if (measureNative.current === measure) measureNative.current = null; };
  }, [measureKey, onMeasure, visible]);
  return <View ref={ref} collapsable={false} style={style} onLayout={(event) => {
    // A queued event may describe the previous page or an intermediate size.
    // Always sample the current committed body, never cache that event's box.
    if (Platform.OS !== "web") { measureNative.current?.(); return; }
    if (typeof ResizeObserver !== "undefined") return;
    onLayout(event);
  }}>{children}</View>;
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
  leading,
  label,
  detail,
  tone,
  trailing,
  selected,
  disabled,
  busy,
  onPress,
  selectionRole,
  role = "menuitem",
  labelLines = 2,
  showSelectionIndicator = true,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  leading?: React.ReactNode;
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
  role?: "menuitem" | "button";
  labelLines?: 1 | 2;
  /** A trailing control can show selection instead of the row fill and checkmark. */
  showSelectionIndicator?: boolean;
}) {
  const { palette, expressive } = useTheme();
  // Expressive menus deliberately use the complementary tertiary pair. With
  // the teal app palette this can be blue; it is not a platform/default tint.
  const selectedContainer = expressive ? palette.tertiaryContainer : palette.surfaceContainerHighest;
  const selectedColor = expressive ? palette.onTertiaryContainer : palette.onSurface;
  const highlightSelection = selected && showSelectionIndicator;
  const color = tone === "danger" ? palette.error : highlightSelection ? selectedColor : palette.onSurface;
  const iconColor = tone === "danger" ? palette.error : highlightSelection ? selectedColor : palette.onSurfaceVariant;
  const inactive = disabled || busy;

  return (
    <PressableScale
      accessibilityRole={selectionRole === "menuitemradio" ? "radio" : selectionRole === "menuitemcheckbox" ? "checkbox" : role}
      {...(Platform.OS === "web" ? { role: (selectionRole ?? role) as PressableProps["role"] } : null)}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: !!inactive, selected: !!selected, busy: !!busy, ...(selectionRole ? { checked: !!selected } : {}) }}
      aria-disabled={!!inactive}
      aria-busy={!!busy}
      disabled={inactive}
      stateLayerColor={color}
      focusOnlyVisible
      onHoverIn={Platform.OS === "web" && !inactive ? (event) => (event.currentTarget as unknown as HTMLElement)?.focus() : undefined}
      onPress={() => {
        if (inactive) return;
        haptics.light();
        onPress();
      }}
      style={[
        styles.item,
        detail ? styles.itemWithDetail : null,
        Platform.OS === "web" ? styles.itemWeb : null,
        inactive && styles.itemDisabled,
        { backgroundColor: highlightSelection ? selectedContainer : "transparent" },
        { borderRadius: expressive ? radius.md : radius.xs, marginHorizontal: expressive ? spacing[8] : 0, paddingHorizontal: expressive ? spacing[16] : spacing[12], overflow: "hidden" },
      ]}
    >
      <View style={styles.iconSlot}>
        {leading ?? (icon ? <AppIcon name={icon} size={24} color={iconColor} /> : null)}
      </View>
      <Text variant="bodyLarge" style={[styles.itemLabel, { color }]} numberOfLines={labelLines}>
        {label}
      </Text>
      {busy ? (
        <Spinner size="sm" color={color} style={styles.itemSide} />
      ) : highlightSelection ? (
        <Ionicons
          name="checkmark"
          size={16}
           color={selectedColor}
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
  itemWithDetail: { gap: spacing[8] },
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
