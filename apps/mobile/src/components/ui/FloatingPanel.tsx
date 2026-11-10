import React from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, useAnimatedScrollHandler, type SharedValue } from "react-native-reanimated";
import { sheetDragOrigin, sheetDragPosition, shouldDismissSheet } from "../../lib/sheet-gesture";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OverlayPortal, useOverlayBlocked } from "./overlay-host";
import { useTheme } from "../../theme/ThemeProvider";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useOverlayFocus } from "../../hooks/use-overlay-focus";
import { useOverlayPage } from "../../hooks/use-overlay-page";
import { useSurfaceSize } from "../../hooks/use-surface-size";
import { useScrimPress } from "../../hooks/use-scrim-press";
import { OverlayPageContent } from "./OverlayPageContent";
import { ResizeOwnerContext } from "./resize-owner";
import { PanelTitleContext } from "./panel-title";
import { PanelPresenceContext } from "./panel-presence";
import type { ButtonVariant } from "./Button";
import { DraftDismissContext, useDraftDismiss } from "./draft-dismiss";
import { PanelHeader } from "./PanelHeader";
import { PanelActions } from "./SheetActionRow";
import { ThemedScrollView, type ThemedScrollViewProps } from "./ThemedScrollView";
import { InputSurfaceContext } from "./input-surface";
import { InputFocusScopeContext, useInputFocusScope, type InputFocusScope } from "./input-focus-scope";
import { panelKeyboardLift } from "../../lib/panel-keyboard-layout";
import { useMaterialMotion } from "../../theme/material-motion";
import { PressableScale } from "./PressableScale";

function panelChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && (child.type === React.Fragment || child.type === ThemedScrollView)
      ? panelChildren(child.props.children) : [child]);
}

/** Header/body/actions decomposition shared by the live page and its ghost. */
function splitPanelChildren(nodes: React.ReactNode[]) {
  const headers = nodes.filter((node) => React.isValidElement(node) && node.type === PanelHeader);
  const actions = nodes.filter((node) => React.isValidElement(node) && node.type === PanelActions);
  return { headers, actions, body: nodes.filter((node) => !headers.includes(node) && !actions.includes(node)) };
}
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import { layout, radius, spacing } from "../../theme/tokens";

/** Native layout should report in the first frame; see the fallback below. */
const READY_FALLBACK_MS = 200;

export interface FloatingPanelProps {
  visible: boolean;
  onDismiss: () => void | boolean;
  onExited?: () => void;
  /** The opening fade and spatial spring have both settled. */
  onEntered?: () => void;
  /** Handoff hook: runs the moment the exit fade starts, while this panel's
   * retained contents finish fading beneath the successor surface. */
  onExiting?: () => void;
  /** Known launch control captured before a sibling overlay hands off focus. */
  triggerRef?: { readonly current: unknown };
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  maxWidth?: number;
  /** Bottom sheets reuse the dialog's focus, Back, and retained exit lifecycle. */
  presentation?: "dialog" | "bottom-sheet" | "responsive";
  /** Non-text draft fields supplement the shared input edit tracking. */
  dirty?: boolean;
  /** Changelog notes allow downward dismissal only when their body is at top. */
  dragFromBody?: boolean;
  /** Pickers whose own field receives the keyboard pass false: the surface's
   * entrance and exit then leave the IME alone so focus transfers between the
   * parent field and the picker's search field without a hide/show cycle. */
  keyboardDismiss?: boolean;
  /** Adaptive sheets animate their height to fit the content, keeping actions
   * anchored at the bottom. Expanded sheets always use the height limit. */
  sheetSizing?: "content" | "expanded" | "adaptive";
  /** Space between a bottom sheet's header and its scrollable body. */
  sheetBodyTopPadding?: number;
  onShow?: () => void | ReturnType<typeof setTimeout> | (() => void);
  /** Size the card to its children instead of stretching toward `maxWidth`. */
  fitContent?: boolean;
  /** When false, the scrim and back button do not close the panel. */
  dismissible?: boolean;
  /** Disable outside-tap dismissal without disabling Back/Escape. */
  dismissOnScrim?: boolean;
  /** Pickers own their virtualized list; don't nest it inside a ScrollView. */
  scrollBody?: boolean;
  /** Reset the notes/picker scroll position when its selected content changes. */
  scrollResetKey?: string;
  /** Bounded navigation lists can prepare offscreen and retain their cells.
   * The hidden surface never owns focus, Back, or background isolation. */
  keepMounted?: boolean;
  /** Keep a draft mounted while a sibling picker is the active surface. */
  obscured?: boolean;
  /** An anchored dropdown can own focus/back without hiding its parent form. */
  interactive?: boolean;
  /** Nested dialog pages fade through in one surface, like context menus. */
  pageKey?: string;
}

/** A prepared successor page, measured offscreen while the current one leaves. */
type PanelGhost = ReturnType<typeof splitPanelChildren>;

export function FloatingPanel(props: FloatingPanelProps) {
  const [activated, setActivated] = React.useState(props.visible);
  if (props.visible && !activated) setActivated(true);
  if (!activated && !props.keepMounted) return null;
  return <GuardedFloatingPanel {...props} />;
}

function GuardedFloatingPanel(props: FloatingPanelProps) {
  const draft = useDraftDismiss(props.visible, props.dirty);
  const onDismiss = React.useCallback(() => draft.scope.request(() => { props.onDismiss(); }), [draft.scope, props.onDismiss]);
  const guarded = { ...props, onDismiss, obscured: !!props.obscured || draft.confirming };
  return <>
    <DraftDismissContext.Provider value={draft.scope}>
      {props.pageKey != null ? <PagedFloatingPanelSurface {...guarded} pageKey={props.pageKey} /> : <FloatingPanelSurface {...guarded} />}
    </DraftDismissContext.Provider>
    {draft.used ? <ConfirmDialog visible={draft.confirming} title="Discard changes?"
      message="Your unsaved changes will be lost." confirmLabel="Discard" cancelLabel="Keep editing"
      onDismiss={draft.keep} onConfirm={draft.discard} /> : null}
  </>;
}

/** Confirmation shares the overlay family without a circular module import. */
export function ConfirmDialog({
  visible,
  onDismiss,
  onExited,
  onExiting,
  icon,
  tone = "danger",
  title,
  message,
  children,
  confirmLabel,
  confirmVariant,
  onConfirm,
  loading = false,
  confirmDisabled = false,
  cancelLabel = "Cancel",
  dismissible = true,
}: {
  visible: boolean;
  onDismiss: () => void;
  onExited?: () => void;
  /** Runs when the exit fade starts; see FloatingPanelProps.onExiting. */
  onExiting?: () => void;
  icon?: React.ComponentProps<typeof PanelHeader>["icon"];
  tone?: "danger" | "accent";
  title: string;
  message: string;
  children?: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  loading?: boolean;
  confirmDisabled?: boolean;
  cancelLabel?: string;
  dismissible?: boolean;
}) {
  const { palette } = useTheme();
  const canDismiss = dismissible && !loading;
  const danger = (confirmVariant ?? (tone === "danger" ? "danger" : "primary")) === "danger";

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={onDismiss}
      onExited={onExited}
      onExiting={onExiting}
      dismissible={canDismiss}
      maxWidth={layout.overlayConfirmWidth}
    >
      <PanelHeader
        title={title}
        subtitle={message}
        icon={icon}
        iconColor={danger ? palette.danger : palette.accent}
        iconBackground={danger ? palette.dangerSoft : palette.accentSoft}
      />
      {children ? <View style={styles.confirmExtra}>{children}</View> : null}
      <PanelActions
        confirmLabel={confirmLabel}
        confirmVariant={danger ? "danger" : "primary"}
        onConfirm={onConfirm}
        onCancel={onDismiss}
        cancelLabel={cancelLabel}
        loading={loading}
        confirmDisabled={confirmDisabled}
        cancelDisabled={!canDismiss}
      />
    </FloatingPanel>
  );
}

function PagedFloatingPanelSurface(props: FloatingPanelProps & { pageKey: string }) {
  // Retain content and scroll ownership together during the outgoing fade.
  const page = useOverlayPage(props.visible, props.pageKey, { children: props.children, scrollBody: props.scrollBody });
  // While the outgoing page fades, the surface measures this successor so the
  // height spring starts in the same commit as the fade-in (see PageGhost).
  const ghost = page.incoming
    ? splitPanelChildren(panelChildren(page.incoming.value.children)) : null;
  return <FloatingPanelSurface {...props} scrollBody={page.content.scrollBody}
    pageLeaving={page.leaving} pageStyle={page.style} ghost={ghost}>{page.content.children}</FloatingPanelSurface>;
}

function FloatingPanelSurface({
  visible,
  onDismiss,
  onExited,
  onEntered,
  onExiting,
  triggerRef,
  children,
  style,
  maxWidth = layout.overlayMaxWidth,
  presentation = "dialog",
  sheetSizing = "content",
  sheetBodyTopPadding = spacing[24],
  onShow,
  fitContent = false,
  dismissible = true,
  dismissOnScrim = true,
  keyboardDismiss = true,
  scrollBody = true,
  scrollResetKey,
  keepMounted = false,
  obscured = false,
  interactive = true,
  pageKey,
  pageStyle,
  dragFromBody = false,
  pageLeaving = false,
  ghost = null,
}: FloatingPanelProps & { pageLeaving?: boolean; pageStyle?: ReturnType<typeof useOverlayPage>["style"]; ghost?: PanelGhost | null }) {
  const { palette } = useTheme();
  const { width, height } = useWindowDimensions();
  const sheet = presentation === "bottom-sheet" || presentation === "responsive" && width < 600;
  const expandedSheet = sheet && sheetSizing === "expanded";
  const adaptiveSheet = sheet && sheetSizing !== "expanded";
  const fillSheet = expandedSheet || adaptiveSheet;
  const panelSurface = sheet ? palette.surfaceContainerLow : palette.surfaceContainerHigh;
  const titleId = React.useId();
  const onShowRef = React.useRef(onShow);
  React.useLayoutEffect(() => { onShowRef.current = onShow; }, [onShow]);
  const [availableHeight, setAvailableHeight] = React.useState(height);
  const [keyboardTop, setKeyboardTop] = React.useState<number | null>(null);
  // Animated native layout reports must not feed React state. A height spring
  // otherwise re-renders this publisher and republishes its entire portal on
  // every frame, competing with Reanimated's Fabric commits.
  const panelHeight = useSharedValue(0);
  // The live chain's natural height, keyed by page: during a page swap the
  // committed height still describes the outgoing page, so the keyed compare
  // is what tells the ghost hand-off apart from a stale report.
  const [naturalContent, setNaturalContent] = React.useState<{ key: string; height: number } | null>(null);
  // The successor's natural height, measured while the outgoing page fades.
  // Applied in the swap commit so the height spring runs with the fade-in
  // instead of trailing it by the live measure's extra commit rounds.
  const [ghostHeight, setGhostHeight] = React.useState<{ key: string; height: number } | null>(null);
  const pageKeyRef = React.useRef<string | undefined>(pageKey);
  pageKeyRef.current = pageKey;
  const [sheetHeaderHeight, setSheetHeaderHeight] = React.useState(0);
  const [sheetActionsHeight, setSheetActionsHeight] = React.useState(0);
  const [sheetBodyHeight, setSheetBodyHeight] = React.useState<number | null>(null);
  const adaptiveReady = !adaptiveSheet || (sheetBodyHeight != null && sheetHeaderHeight > 0 && sheetActionsHeight > 0);
  const [measured, setMeasured] = React.useState(false);
  const [layoutFallback, setLayoutFallback] = React.useState(false);
  const dragOffset = useSharedValue(height);
  const releaseVelocity = useSharedValue(0);
  const adaptiveHeight = useSharedValue(height * 0.9);
  const resting = React.useRef({ width, height });
  if (width !== resting.current.width || Platform.OS === "web") resting.current = { width, height };
  else resting.current.height = Math.max(resting.current.height, height);
  const restHeight = resting.current.height;
  const motion = useMaterialMotion();
  const insets = useSafeAreaInsets();
  const hideAndDismiss = React.useCallback(() => {
    if (!dismissible) return false;
    dismissKeyboard();
    return onDismiss() !== false;
  }, [dismissible, onDismiss]);
  const scrimPress = useScrimPress(visible && interactive && !obscured && dismissOnScrim, hideAndDismiss);
  const layoutReady = (Platform.OS === "web" || measured) && adaptiveReady && (fillSheet || naturalContent != null);
  const { rendered, progress, spatial } = useOverlayPresence(visible, hideAndDismiss, {
    interactive: interactive && !obscured, onEntered, onExited, onExiting, ready: layoutReady || layoutFallback,
    dismissKeyboard: keyboardDismiss,
  });
  React.useEffect(() => {
    if (!rendered && !keepMounted) { setMeasured(false); setNaturalContent(null); setLayoutFallback(false); setGhostHeight(null); }
  }, [rendered, keepMounted]);
  // A layout report should arrive in the first frame. If it never does,
  // release the entrance instead of keeping an invisible, blocking dialog.
  React.useEffect(() => {
    if (!visible || layoutReady || layoutFallback) return;
    const timer = setTimeout(() => {
      setMeasured(true);
      // A timeout is not a zero-height measurement. Keep the provisional
      // viewport until real content geometry arrives instead of collapsing
      // the entire dialog to its padding and clipping all controls.
      setLayoutFallback(true);
    }, READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [visible, layoutReady, layoutFallback]);
  const panelRef = useOverlayFocus(visible && rendered, hideAndDismiss, "dialog", dismissible, false, !interactive || obscured, undefined, undefined, triggerRef);
  // A sibling picker obscures this panel while staying mounted above it.
  // Crossfade this panel and its scrim (same 200ms inOut quad as the
  // picker's own fade, so the stacked scrims keep a constant dim) instead
  // of cutting to display:none; the display switch only happens after the
  // fade-out settles, and is lifted before fading back in.
  const obscuredFade = useSharedValue(obscured ? 0 : 1);
  const [collapsedObscured, setCollapsedObscured] = React.useState(obscured);
  const lastObscured = React.useRef(obscured);
  const previousFade = React.useRef({ obscured, reducedMotion: motion.reducedMotion, visible });
  const finishObscuring = React.useCallback(() => {
    if (lastObscured.current) setCollapsedObscured(true);
  }, []);
  React.useLayoutEffect(() => {
    lastObscured.current = obscured;
    const previous = previousFade.current;
    previousFade.current = { obscured, reducedMotion: motion.reducedMotion, visible };
    if (!visible) {
      // The surface is exiting. Uncovering it here because a sibling picker
      // closed in the same commit would fade a hidden panel/scrim back in
      // underneath the exit; keep it collapsed and let a future open reveal it.
      if (obscured) {
        obscuredFade.value = 0;
        if (!collapsedObscured) setCollapsedObscured(true);
      }
      return;
    }
    if (previous.visible === visible && previous.obscured === obscured && previous.reducedMotion === motion.reducedMotion) return;
    if (motion.reducedMotion) {
      obscuredFade.value = obscured ? 0 : 1;
      setCollapsedObscured(obscured);
      return;
    }
    const fade = { duration: 200, easing: Easing.inOut(Easing.quad) };
    if (obscured) {
      obscuredFade.value = withTiming(0, fade, (finished) => {
        if (finished) runOnJS(finishObscuring)();
      });
      return;
    }
    setCollapsedObscured(false);
    obscuredFade.value = withTiming(1, fade);
  }, [obscured, visible, obscuredFade, finishObscuring, motion.reducedMotion, collapsedObscured]);
  const lastChildren = React.useRef(children);
  const dormant = keepMounted && !rendered;
  React.useLayoutEffect(() => { if (visible || dormant) lastChildren.current = children; }, [visible, dormant, children]);
  // Freeze only an actual exit. Dormant preparation must reach the retained
  // tree, otherwise staged controls are silently deferred back onto the tap.
  const displayedChildren = visible || dormant ? children : lastChildren.current;
  const { headers, actions, body } = React.useMemo(() => {
    const nodes = panelChildren(displayedChildren);
    const headers = nodes.filter((node) => React.isValidElement(node) && node.type === PanelHeader);
    const actions = nodes.filter((node) => React.isValidElement(node) && node.type === PanelActions);
    return { headers, actions, body: nodes.filter((node) => !headers.includes(node) && !actions.includes(node)) };
  }, [displayedChildren]);
  const viewportHeight = Math.min(height, availableHeight, keyboardTop ?? Infinity);
  const bottomInset = keyboardTop == null ? insets.bottom : 0;
  const heightLimit = sheet
    ? Math.max(80, Math.min(viewportHeight * 0.9, viewportHeight - insets.top - spacing[16]))
    : Math.max(80, viewportHeight - insets.top - bottomInset - spacing[32]);
  const fittedSheetHeight = Math.min(heightLimit, sheetHeaderHeight + sheetActionsHeight + (sheetBodyHeight ?? 0) + sheetBodyTopPadding + spacing[24]);
  // In extremely short windows/above a keyboard, scroll the whole sheet.
  const sheetScrollAll = scrollBody && (heightLimit < 280
    || fillSheet && heightLimit - sheetHeaderHeight - sheetActionsHeight < spacing[96]);
  // Android text should travel with a native transform, not be repositioned
  // by Yoga on every height-spring frame. A full-height surface slides below
  // the window; its visible extent is still the measured adaptive height.
  // Keep compact/keyboard layouts on the ordinary all-content scroller.
  const translatedAdaptiveSheet = adaptiveSheet && Platform.OS === "android" && !sheetScrollAll;
  const previousSize = React.useRef({ visible: false, ready: false, width, height });
  React.useLayoutEffect(() => {
    const previous = previousSize.current;
    previousSize.current = { visible, ready: adaptiveReady, width, height };
    if (!translatedAdaptiveSheet || !adaptiveReady || !visible) return;
    const animate = previous.visible && previous.ready && previous.width === width && previous.height === height && !motion.reducedMotion;
    adaptiveHeight.value = animate
      ? withSpring(fittedSheetHeight, { ...motion.spatial, overshootClamping: true })
      : fittedSheetHeight;
  }, [translatedAdaptiveSheet, adaptiveReady, fittedSheetHeight, visible, width, height, motion, adaptiveHeight]);
  const adaptiveSizeStyle = useSurfaceSize(adaptiveSheet && !translatedAdaptiveSheet ? adaptiveReady ? fittedSheetHeight : heightLimit : null, {
    active: visible && !obscured && adaptiveReady,
    geometryKey: `${width}:${height}:${keyboardTop}:${heightLimit}:${insets.top}:${insets.bottom}`,
  });
  const sheetActionsStyle = useAnimatedStyle(() => translatedAdaptiveSheet
    ? { transform: [{ translateY: adaptiveHeight.value - heightLimit }] } : {});
  const sheetInset = width < 600 ? spacing[16] : spacing[24];
  const sheetWidth = Math.min(maxWidth, width - insets.left - insets.right);
  const dialogWidth = Math.max(0, Math.min(maxWidth, width - insets.left - insets.right - spacing[32]));
  const corners = sheet ? {
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  } : { borderRadius: radius["2xl"] };
  // Opening the keyboard must not also change the form's horizontal padding.
  const panelPadding = restHeight - insets.top - insets.bottom - spacing[32] < 480 ? spacing[16] : layout.overlayPadding;
  const customStyle = StyleSheet.flatten(style);
  const topPadding = customStyle?.paddingTop ?? customStyle?.paddingVertical ?? customStyle?.padding ?? (sheet ? 0 : panelPadding);
  const bottomPadding = customStyle?.paddingBottom ?? customStyle?.paddingVertical ?? customStyle?.padding ?? (sheet ? 0 : panelPadding);
  // The ghost only wins in the swap commit, while the keyed live measure
  // still describes the outgoing page. The first live report keyed to this
  // page is the real geometry and is authoritative from there on.
  const liveReady = naturalContent != null && naturalContent.key === pageKey;
  const ghostReady = !pageLeaving && ghostHeight != null && ghostHeight.key === pageKey && !liveReady;
  const measuredNaturalHeight = ghostReady ? ghostHeight.height : naturalContent?.height ?? null;
  React.useLayoutEffect(() => {
    if (pageLeaving || !liveReady) return;
    setGhostHeight(null);
  }, [pageLeaving, liveReady]);
  const fittedContentHeight = !fillSheet && measuredNaturalHeight != null
    ? Math.min(heightLimit, measuredNaturalHeight + Number(topPadding) + Number(bottomPadding)) : null;
  const contentSizeStyle = useSurfaceSize(fittedContentHeight, {
    active: visible && !obscured,
    geometryKey: `${width}:${height}:${keyboardTop}:${heightLimit}:${panelPadding}`,
  });
  // In short windows/above the IME, let the title scroll with the content so
  // long confirmations cannot push their actions out of the visible panel.
  const scrollHeader = heightLimit < 360;
  const scrollAll = scrollBody && heightLimit < 220;
  const recordNaturalHeight = React.useCallback((next: number) => {
    if (next <= 0 || obscured) return;
    const key = pageKeyRef.current ?? "";
    setNaturalContent(current => current != null && current.key === key && Math.abs(current.height - next) < 0.5
      ? current : { key, height: next });
  }, [obscured]);
  const recordGhostHeight = React.useCallback((next: number) => {
    if (next <= 0) return;
    const key = pageKeyRef.current ?? "";
    setGhostHeight(current => current != null && current.key === key && Math.abs(current.height - next) < 0.5
      ? current : { key, height: next });
  }, []);

  React.useLayoutEffect(() => {
    if (!visible) return;
    setAvailableHeight(height);
    if (Platform.OS !== "web") {
      const metrics = Keyboard.metrics();
      setKeyboardTop(metrics?.height ? metrics.screenY : null);
    }
    // Opening starts from the current viewport, never the previous IME session.
  }, [visible, height, dragOffset]);

  React.useEffect(() => {
    if (Platform.OS === "web" || !rendered) return;
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow", (event) => {
      setKeyboardTop(event.endCoordinates.height > 0 ? event.endCoordinates.screenY : null);
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardTop(null));
    const metrics = Keyboard.metrics();
    setKeyboardTop(metrics?.height ? metrics.screenY : null);
    return () => { show.remove(); hide.remove(); };
  }, [rendered]);

  const keyboardLift = useDerivedValue(() => {
    // Browser layout already follows its visual viewport; no keyboard worklet.
    if (Platform.OS === "web") return 0;
    const center = (restHeight + insets.top - insets.bottom) / 2;
    return sheet ? Math.min(0, viewportHeight - restHeight)
      : panelKeyboardLift(center, panelHeight.value, viewportHeight, insets.top + spacing[16], bottomInset + spacing[16]);
  });
  // Separate the target from its animation: ordinary resizes that keep lift
  // at zero must not restart a timing animation on every layout report.
  const keyboardShift = useDerivedValue(() => motion.reducedMotion ? keyboardLift.value
    : withTiming(keyboardLift.value, { duration: 250, easing: Easing.bezier(0.2, 0, 0, 1) }));
  const recordPanelLayout = React.useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (next <= 0) return;
    if (!measured) setMeasured(true);
    // Sheets are bottom anchored: keyboard placement never needs their height.
    // Dialog geometry stays on the UI runtime, including during live resizes.
    if (!sheet) panelHeight.value = next;
  }, [measured, panelHeight, sheet]);

  const sheetWasOpen = React.useRef(false);
  React.useLayoutEffect(() => {
    if (!sheet) { sheetWasOpen.current = false; return; }
    const open = visible && (layoutReady || layoutFallback);
    if (open && !sheetWasOpen.current) {
      cancelAnimation(dragOffset);
      dragOffset.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
    } else if (!visible && sheetWasOpen.current) {
      dragOffset.value = motion.reducedMotion ? heightLimit : withSpring(heightLimit, { ...motion.spatial, velocity: releaseVelocity.value });
      releaseVelocity.value = 0;
    }
    sheetWasOpen.current = open;
  }, [sheet, visible, layoutReady, layoutFallback, heightLimit, motion, dragOffset, releaseVelocity]);
  React.useLayoutEffect(() => {
    // A draft confirmation or sibling picker takes ownership without closing
    // this retained surface. Bring its sole drag value back to rest.
    if (visible && obscured && sheet) dragOffset.value = motion.reducedMotion ? 0 : withSpring(0, { ...motion.spatial, velocity: releaseVelocity.value });
  }, [visible, obscured, sheet, dragOffset, releaseVelocity, motion]);
  const dragDismiss = React.useCallback((velocity: number) => {
    releaseVelocity.value = velocity;
    const accepted = hideAndDismiss();
    const target = accepted ? heightLimit : 0;
    dragOffset.value = motion.reducedMotion ? target : withSpring(target, { ...motion.spatial, velocity });
    if (!accepted) releaseVelocity.value = 0;
  }, [hideAndDismiss, heightLimit, releaseVelocity, dragOffset, motion]);
  const previousPage = React.useRef(pageKey);
  React.useLayoutEffect(() => {
    if (pageKey !== previousPage.current && visible && sheet) {
      dragOffset.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
      releaseVelocity.value = 0;
    }
    previousPage.current = pageKey;
  }, [pageKey, visible, sheet, motion, dragOffset, releaseVelocity]);
  const gestureEnabled = sheet && dismissible && visible && interactive && !obscured;
  const fadeStyle = useAnimatedStyle(() => ({ opacity: progress.value * obscuredFade.value }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * obscuredFade.value * (sheet ? Math.max(0, 1 - Math.max(0, dragOffset.value) / heightLimit) : 1),
  }));
  // Web keeps its input ancestors untransformed/unclipped. Fade a separate
  // clipped surface and the contents, rather than compositing the entire
  // rounded panel (which leaves a square backing in Chromium).
  const panelStyle = useAnimatedStyle(() => sheet ? {
    opacity: progress.value * obscuredFade.value,
    transform: [{ translateY: keyboardShift.value + dragOffset.value
      + (translatedAdaptiveSheet ? heightLimit - adaptiveHeight.value : 0) }],
  } : Platform.OS === "web" ? {} : ({
    opacity: progress.value * obscuredFade.value,
    transform: [{ translateY: keyboardShift.value + (1 - spatial.value) * 24 }, ...(Platform.OS === "ios" ? [{ scale: 0.94 + spatial.value * 0.06 }] : [])],
  }));

  const inputFocusScope = useInputFocusScope(visible && rendered && interactive && !obscured,
    layoutReady || layoutFallback, visible);
  const presenceScope = React.useMemo(() => ({ visible, rendered }), [visible, rendered]);

  if (!rendered && !keepMounted) return null;

  const sheetHeader = <SheetDragHeader enabled={gestureEnabled} dismissible={dismissible}
    offset={dragOffset} onDismiss={dragDismiss} onHandleDismiss={hideAndDismiss} surface={panelSurface}
    onLayout={(event) => setSheetHeaderHeight(event.nativeEvent.layout.height)}>
    <View style={{ paddingHorizontal: sheetInset, paddingBottom: spacing[8] }}>
      {headers.map((header) => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
        ? React.cloneElement(header, { style: [header.props.style, { marginBottom: 0 }] }) : header)}
    </View>
  </SheetDragHeader>;
  const sheetActions = <View testID="material-sheet-actions" onLayout={(event) => setSheetActionsHeight(event.nativeEvent.layout.height)}
    style={{ paddingHorizontal: sheetInset, paddingBottom: Math.max(spacing[16], bottomInset),
      backgroundColor: panelSurface }}>
    {actions.map((action) => React.isValidElement<React.ComponentProps<typeof PanelActions>>(action)
      ? React.cloneElement(action, { topSpacing: 16 }) : action)}
  </View>;
  const sheetBodyPadding = { paddingHorizontal: sheetInset, paddingTop: sheetBodyTopPadding, paddingBottom: spacing[24] };
  // Translated (Android) bodies keep the explicit height only when their own
  // scroll viewport needs a definite parent to measure against. A picker body
  // (scrollBody=false) must stay auto: its measuring child sits INSIDE this
  // view, so deriving the height from that measurement let a shrinkable body
  // collapse to the available space, report 0, and pin the sheet at
  // header+actions (a fixed point that clipped the first field). An auto body
  // is always the right visible extent anyway - its natural height up to the
  // maxHeight clamp, which equals fittedSheetHeight - header - actions
  // whenever the clamp binds - and the actions pin to the same extent.
  const sheetBodyStyle = { flex: fillSheet && !translatedAdaptiveSheet ? 1 : undefined, flexShrink: 1,
    ...(translatedAdaptiveSheet && scrollBody ? { height: Math.max(0, fittedSheetHeight - sheetHeaderHeight - sheetActionsHeight) } : {}),
    maxHeight: Math.max(0, heightLimit - sheetHeaderHeight - sheetActionsHeight), backgroundColor: panelSurface };
  // Measure natural content, independently of the animated scroll viewport.
  // A viewport measurement here would feed the height animation back into
  // itself and make short notes collapse or oscillate while switching.
  const sheetBody = adaptiveSheet ? <View style={{ flexShrink: 0 }} onLayout={(event) => setSheetBodyHeight(event.nativeEvent.layout.height)}>{body}</View> : body;
  const sheetScrollProps = {
    resetKey: scrollResetKey,
    dismissDrag: dragFromBody ? { enabled: gestureEnabled, offset: dragOffset, onDismiss: dragDismiss } : undefined,
  };
  const sheetContent = sheetScrollAll
    ? <SheetScrollView {...sheetScrollProps} testID="material-sheet-body" nestedScrollEnabled
        style={{ flex: fillSheet ? 1 : undefined, flexShrink: 1, maxHeight: heightLimit, backgroundColor: panelSurface }}>
        {sheetHeader}<View style={sheetBodyPadding}>{sheetBody}</View>{sheetActions}
      </SheetScrollView>
    : <>{sheetHeader}
        {scrollBody ? fillSheet ? <View style={sheetBodyStyle}>
          <SheetScrollView {...sheetScrollProps} testID="material-sheet-body" nestedScrollEnabled
            style={{ flex: 1 }} contentContainerStyle={sheetBodyPadding}>{sheetBody}</SheetScrollView>
          <SheetScrollFades color={panelSurface} />
        </View> : <SheetScrollView {...sheetScrollProps} testID="material-sheet-body" nestedScrollEnabled
          style={sheetBodyStyle} contentContainerStyle={sheetBodyPadding}>{body}</SheetScrollView>
          : <View testID="material-sheet-body" style={[sheetBodyStyle, sheetBodyPadding]}>{sheetBody}</View>}
        {translatedAdaptiveSheet ? <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, sheetActionsStyle]}>
          {sheetActions}
        </Animated.View> : sheetActions}
      </>;

  return (
    <OverlayPortal blocking={rendered} active={visible && interactive && !obscured}>
      <InputFocusScopeContext.Provider value={inputFocusScope}>
      <PanelPresenceContext.Provider value={presenceScope}>
      <PanelOnShow visible={visible} enabled={inputFocusScope.active && inputFocusScope.ready} onShowRef={onShowRef} />
      <View
        accessibilityViewIsModal={visible && interactive && !obscured}
        accessibilityElementsHidden={!visible || obscured}
        importantForAccessibility={!visible || obscured ? "no-hide-descendants" : "auto"}
        aria-hidden={!visible || obscured}
        pointerEvents={visible && interactive && !obscured ? "auto" : "none"}
        // A retained surface stays laid out at opacity zero. display:none
        // would discard its measurements and repeat the cold layout on open.
        style={[styles.root, collapsedObscured ? { display: "none" } : null,
          Platform.OS === "web" && !rendered ? { visibility: "hidden" } as unknown as ViewStyle : null]}
        onLayout={Platform.OS === "web" ? undefined : (event) => { const next = event.nativeEvent.layout.height; if (!obscured && next > 0) setAvailableHeight((current) => Math.abs(current - next) < 1 ? current : next); }}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} />
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={StyleSheet.absoluteFill}
          onPressIn={dismissible && dismissOnScrim ? dismissKeyboard : undefined}
          {...scrimPress}
        />
          <View pointerEvents="box-none" style={[styles.frame, { paddingTop: insets.top + spacing[16], paddingBottom: insets.bottom + spacing[16] },
            sheet ? { justifyContent: "flex-end", paddingBottom: 0, paddingLeft: insets.left, paddingRight: insets.right }
              : { paddingLeft: insets.left + spacing[16], paddingRight: insets.right + spacing[16] },
            Platform.OS !== "web" ? { flex: 0, height: restHeight } : null]}>
          <Animated.View
            ref={panelRef}
            onLayout={Platform.OS === "web" || (sheet && measured) ? undefined : recordPanelLayout}
            role="dialog"
            aria-modal={visible && interactive && !obscured}
            aria-hidden={!visible}
            aria-labelledby={titleId}
            accessibilityLabel={headers.map((child) => React.isValidElement(child) ? (child.props as { title?: string }).title : undefined).find(Boolean)}
            accessibilityLabelledBy={titleId}
            accessibilityViewIsModal={visible && interactive && !obscured}
            {...(Platform.OS === "web" ? { tabIndex: -1, dataSet: { materialOverlay: visible && interactive && !obscured ? "true" : "false" } } : {})}
            style={[
              styles.panel,
              {
                width: sheet ? sheetWidth : fitContent ? undefined : dialogWidth,
                maxWidth: sheet ? sheetWidth : dialogWidth,
                padding: sheet ? 0 : panelPadding,
                minWidth: fitContent ? Math.min(280, dialogWidth) : undefined,
                maxHeight: heightLimit,
                // Native flex:1 children need a definite first viewport to
                // produce header/body/action measurements. Without it Yoga
                // collapses the unmeasured dialog before those callbacks run.
                height: fillSheet || naturalContent?.height == null ? heightLimit : undefined,
                backgroundColor: Platform.OS === "web" ? "transparent" : panelSurface,
                ...corners,
                ...(sheet ? { overflow: "hidden" as const } : {}),
              },
              panelStyle,
              adaptiveSizeStyle,
              style,
              contentSizeStyle,
            ]}
          >
            {/* A separate web surface avoids the square compositing fringe on
                opacity-animated rounded cards without clipping input carets. */}
            {Platform.OS === "web" ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
              backgroundColor: panelSurface,
              ...corners,
              zIndex: "auto",
              isolation: "auto",
              overflow: "hidden",
            } as unknown as ViewStyle, fadeStyle]} /> : null}
            <ResizeOwnerContext.Provider value>
            <PanelTitleContext.Provider value={titleId}>
            <InputSurfaceContext.Provider value={panelSurface}>
            {sheet ? <OverlayPageContent leaving={pageLeaving} style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" ? fadeStyle : null, pageStyle]}>
              {sheetContent}
            </OverlayPageContent> : <DialogContent headers={headers} actions={actions} body={body}
              scrollHeader={scrollHeader} scrollAll={scrollAll} scrollBody={scrollBody}
              scrollResetKey={scrollResetKey} heightLimit={Math.max(0, heightLimit - Number(topPadding) - Number(bottomPadding))}
              onMeasure={recordNaturalHeight} leaving={pageLeaving} style={pageStyle} fade={Platform.OS === "web" ? fadeStyle : undefined}
              ghost={ghost} onGhostMeasure={recordGhostHeight} />}
            </InputSurfaceContext.Provider>
            </PanelTitleContext.Provider>
            </ResizeOwnerContext.Provider>
          </Animated.View>
          </View>
      </View>
      </PanelPresenceContext.Provider>
      </InputFocusScopeContext.Provider>
    </OverlayPortal>
  );
}

type SheetDismissDrag = { enabled: boolean; offset: SharedValue<number>; onDismiss: (velocity: number) => void };
function SheetDragHeader({ enabled, offset, onDismiss, dismissible, onHandleDismiss, surface, onLayout, children }: SheetDismissDrag & {
  dismissible: boolean; onHandleDismiss: () => void; surface: string;
  onLayout: (event: LayoutChangeEvent) => void; children: React.ReactNode;
}) {
  const pressAfter = useSharedValue(0);
  const pan = useSheetPan(enabled, offset, onDismiss, undefined, pressAfter);
  return <GestureDetector gesture={pan}><View testID="material-sheet-header" onLayout={onLayout} style={{ backgroundColor: surface }}>
    <SheetHandle dismissible={dismissible} onDismiss={() => { if (Date.now() >= pressAfter.value) onHandleDismiss(); }} />
    {children}
  </View></GestureDetector>;
}

function SheetScrollView({ dismissDrag, ...props }: ThemedScrollViewProps & { resetKey?: string; dismissDrag?: SheetDismissDrag }) {
  return dismissDrag ? <DraggablePanelScrollView {...props} dismissDrag={dismissDrag} /> : <PanelScrollView {...props} />;
}

/** Only a sheet body that supports dismissal registers these worklets. Dialogs
 * and list-owned pickers keep their existing native scroll ownership. */
function DraggablePanelScrollView({ dismissDrag, ...props }: ThemedScrollViewProps & { resetKey?: string; dismissDrag: SheetDismissDrag }) {
  const scroll = useSharedValue(0);
  const pan = useSheetPan(dismissDrag.enabled, dismissDrag.offset, dismissDrag.onDismiss, scroll);
  const onScroll = useAnimatedScrollHandler({ onScroll: e => { scroll.value = e.contentOffset.y; } });
  return <PanelScrollView {...props} scrollGesture={pan} animatedScrollHandler={onScroll} bounces={false}
    scrollEventThrottle={16} onScroll={Platform.OS === "web" ? e => { scroll.value = e.nativeEvent.contentOffset.y; } : undefined} />;
}

/** Reset after the portal commits the new contents, preserving the native
 * scroller, scrollbar worklets and text instances across release switches. */
function PanelScrollView({ resetKey, ...props }: ThemedScrollViewProps & { resetKey?: string }) {
  const ref = React.useRef<React.ComponentRef<typeof ThemedScrollView>>(null);
  React.useLayoutEffect(() => {
    if (resetKey != null) ref.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [resetKey]);
  return <ThemedScrollView ref={ref} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" {...props} />;
}

/** The body reports its intrinsic content size independently of its viewport.
 * Header and actions participate in the CURRENT animated height, so actions
 * never land outside the card while its target size is still being reached. */
function DialogContent({ headers, actions, body, scrollHeader, scrollAll, scrollBody,
  scrollResetKey, heightLimit, onMeasure, style, fade, leaving, ghost, onGhostMeasure }: {
  headers: React.ReactNode[]; actions: React.ReactNode[]; body: React.ReactNode[];
  scrollHeader: boolean; scrollAll: boolean; scrollBody: boolean;
  scrollResetKey?: string; heightLimit: number; onMeasure: (height: number) => void;
  style?: ReturnType<typeof useOverlayPage>["style"];
  fade?: ReturnType<typeof useOverlayPage>["style"];
  leaving: boolean;
  ghost?: PanelGhost | null;
  onGhostMeasure?: (height: number) => void;
}) {
  const [headerHeight, setHeaderHeight] = React.useState(0);
  const [actionsHeight, setActionsHeight] = React.useState(0);
  const [bodyHeight, setBodyHeight] = React.useState<number | null>(null);
  const gap = !scrollHeader && headers.length && body.length ? spacing[16] : 0;
  const fixedHeader = !scrollHeader && headers.length > 0;
  const fixedActions = !scrollAll && actions.length > 0;
  const content = scrollHeader ? [...headers.map(header => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
    ? React.cloneElement(header, { style: [header.props.style, { marginBottom: body.length ? spacing[24] : 0 }] }) : header),
    ...body, ...(scrollAll ? actions : [])] : body;
  // Bound list-owned pickers against the AVAILABLE space, never the current
  // animated body. Their virtualized viewport must shrink on short windows
  // so its last row remains scrollable rather than clipped below the actions.
  const bodyLimit = Math.max(0, heightLimit - (fixedHeader ? headerHeight : 0) - (fixedActions ? actionsHeight : 0) - gap);
  const naturalBodyHeight = content.length ? bodyHeight : 0;
  React.useLayoutEffect(() => {
    if (naturalBodyHeight == null || fixedHeader && headerHeight === 0 || fixedActions && actionsHeight === 0) return;
    onMeasure(Math.min(heightLimit, (fixedHeader ? headerHeight : 0) + (fixedActions ? actionsHeight : 0) + naturalBodyHeight + gap));
  }, [naturalBodyHeight, headerHeight, actionsHeight, fixedHeader, fixedActions, gap, heightLimit, onMeasure]);
  const recordBody = React.useCallback((next: number) => {
    setBodyHeight(current => current != null && Math.abs(current - next) < 0.5 ? current : next);
  }, []);
  return <OverlayPageContent leaving={leaving} testID="material-dialog-content" style={[{ flex: 1, minHeight: 0 }, fade, style]}>
    {fixedHeader ? <View style={{ flexShrink: 0 }} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      {headers.map(header => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
        ? React.cloneElement(header, { style: [header.props.style, { marginBottom: 0 }] }) : header)}
    </View> : null}
    <View testID="material-dialog-body" style={{ flex: 1, minHeight: 0, marginTop: gap, overflow: "hidden" }}>
      {scrollBody ? <PanelScrollView resetKey={scrollResetKey} keyboardShouldPersistTaps="handled" nestedScrollEnabled
        style={{ flex: 1 }} onContentSizeChange={(_width, next) => recordBody(next)}>{content}</PanelScrollView>
        : <View style={{ flexShrink: 0, maxHeight: bodyLimit }} onLayout={event => recordBody(event.nativeEvent.layout.height)}>{content}</View>}
      {ghost && onGhostMeasure ? <PageGhost headers={ghost.headers} actions={ghost.actions} body={ghost.body}
        scrollHeader={scrollHeader} scrollAll={scrollAll} heightLimit={bodyLimit} onMeasure={onGhostMeasure} /> : null}
    </View>
    {fixedActions ? <View testID="material-dialog-actions" style={{ flexShrink: 0 }}>
      <View onLayout={event => setActionsHeight(event.nativeEvent.layout.height)}>{actions}</View>
    </View> : null}
  </OverlayPageContent>;
}

/** Offscreen measurement of the page a fading dialog is leaving. Rendering it
 * during the outgoing fade lets the surface spring to the successor's height
 * in the swap commit, together with the incoming fade, instead of trailing
 * the fade by the live measure's extra commit rounds (a late second motion
 * the eye reads as a jump). Painted nothing, receives nothing. */
function PageGhost({ headers, actions, body, scrollHeader, scrollAll, heightLimit, onMeasure }: {
  headers: React.ReactNode[]; actions: React.ReactNode[]; body: React.ReactNode[];
  scrollHeader: boolean; scrollAll: boolean; heightLimit: number;
  onMeasure: (height: number) => void;
}) {
  const [headerHeight, setHeaderHeight] = React.useState(0);
  const [actionsHeight, setActionsHeight] = React.useState(0);
  const [bodyHeight, setBodyHeight] = React.useState<number | null>(null);
  const gap = !scrollHeader && headers.length && body.length ? spacing[16] : 0;
  const fixedHeader = !scrollHeader && headers.length > 0;
  const fixedActions = !scrollAll && actions.length > 0;
  React.useEffect(() => {
    if (bodyHeight == null || fixedHeader && headerHeight === 0 || fixedActions && actionsHeight === 0) return;
    onMeasure(Math.min(heightLimit, (fixedHeader ? headerHeight : 0) + (fixedActions ? actionsHeight : 0) + bodyHeight + gap));
  }, [bodyHeight, headerHeight, actionsHeight, fixedHeader, fixedActions, gap, heightLimit, onMeasure]);
  const ref = React.useRef<View>(null);
  React.useLayoutEffect(() => {
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = true;
  }, []);
  return <InputFocusScopeContext.Provider value={GHOST_FOCUS_SCOPE}>
    <View ref={ref} pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants"
      testID="material-dialog-ghost" style={[StyleSheet.absoluteFill, styles.ghost]}>
      {fixedHeader ? <View style={{ flexShrink: 0 }} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
        {headers.map(header => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
          ? React.cloneElement(header, { style: [header.props.style, { marginBottom: 0 }] }) : header)}
      </View> : null}
      <View onLayout={event => setBodyHeight(event.nativeEvent.layout.height)}>{body}</View>
      {fixedActions ? <View onLayout={event => setActionsHeight(event.nativeEvent.layout.height)}>{actions}</View> : null}
    </View>
  </InputFocusScopeContext.Provider>;
}

/** The ghost's fields live outside every real overlay scope: never the top
 * owner, so they cannot take native focus, keep the keyboard, or win a resume
 * while their invisible measurement copy exists. */
const GHOST_FOCUS_SCOPE: InputFocusScope = { active: false, ready: false, session: 0, owner: -1 };

/** Keep partially scrolled lines from colliding with the sheet's fixed chrome.
 * Body padding leaves the first and last lines clear of these 24dp fades. */
function SheetScrollFades({ color }: { color: string }) {
  const id = React.useId().replace(/:/g, "");
  return <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    {(["top", "bottom"] as const).map((edge) => <Svg key={edge} width="100%" height={spacing[24]}
      style={{ position: "absolute", [edge]: 0 }}>
      <Defs><LinearGradient id={`${id}-${edge}`} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={color} stopOpacity={edge === "top" ? 1 : 0} />
        <Stop offset="1" stopColor={color} stopOpacity={edge === "top" ? 0 : 1} />
      </LinearGradient></Defs>
      <Rect width="100%" height="100%" fill={`url(#${id}-${edge})`} />
    </Svg>)}
  </View>;
}

/** Run opening callbacks where the portal's real blocking context is known.
 * A newer surface cancels any pending focus timer; uncovering the old panel
 * does not resurrect that automatic request. */
const PanelOnShow = React.memo(function PanelOnShow({ visible, enabled, onShowRef }: {
  visible: boolean;
  enabled: boolean;
  onShowRef: React.RefObject<FloatingPanelProps["onShow"]>;
}) {
  const blocked = useOverlayBlocked();
  const consumed = React.useRef(false);
  React.useEffect(() => {
    if (!visible) { consumed.current = false; return; }
    if (!enabled) return;
    if (blocked) { consumed.current = true; return; }
    if (consumed.current) return;
    consumed.current = true;
    const cleanup = onShowRef.current?.();
    return () => {
      if (typeof cleanup === "function") cleanup();
      else if (cleanup != null) clearTimeout(cleanup);
    };
  }, [visible, enabled, blocked, onShowRef]);
  return null;
});

/** Finger tracking is direct; settling always starts from the current value.
 * Body recognition fails immediately unless it begins at the scroll boundary. */
function useSheetPan(enabled: boolean, offset: SharedValue<number>, onDismiss: (velocity: number) => void, scroll?: SharedValue<number>, pressAfter?: SharedValue<number>) {
  const { reducedMotion, spatial } = useMaterialMotion();
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const touchStart = useSharedValue({ x: 0, y: 0 });
  return React.useMemo(() => {
    const pan = Gesture.Pan().enabled(enabled).activeOffsetY([-8, 8]).failOffsetX([-16, 16])
    .manualActivation(!!scroll)
    .onTouchesDown((e, manager) => {
      if (!scroll) return;
      const t = e.allTouches[0];
      if (!t || scroll.value > 1 || e.numberOfTouches !== 1) { manager.fail(); return; }
      touchStart.value = { x: t.absoluteX, y: t.absoluteY };
    })
    .onTouchesMove((e, manager) => {
      if (!scroll) return;
      if (scroll.value > 1 || e.numberOfTouches !== 1) { manager.fail(); return; }
      // Pan translation is available at activation; never steal upward scroll.
      const touch = e.allTouches[0];
      if (!touch) { manager.fail(); return; }
      const dx = touch.absoluteX - touchStart.value.x, dy = touch.absoluteY - touchStart.value.y;
      if (dy < -8 || Math.abs(dx) > 16) manager.fail();
      else if (dy > 8) manager.activate();
    })
    .onBegin(() => { cancelAnimation(offset); start.value = sheetDragOrigin(offset.value); dragging.value = true; })
    .onStart(() => { if (pressAfter) pressAfter.value = Infinity; })
    .onUpdate(e => {
      offset.value = sheetDragPosition(start.value, e.translationY);
    })
    .onEnd(e => {
      dragging.value = false;
      if (shouldDismissSheet(offset.value, e.velocityY)) runOnJS(onDismiss)(e.velocityY);
      else offset.value = reducedMotion ? 0 : withSpring(0, { ...spatial, velocity: e.velocityY });
    })
    .onFinalize((_e, success) => {
      if (!success && dragging.value) offset.value = reducedMotion ? 0 : withSpring(0, spatial);
      dragging.value = false;
      if (pressAfter?.value === Infinity) pressAfter.value = Date.now() + 200;
    });
    return scroll ? Gesture.Simultaneous(Gesture.Native(), pan) : pan;
  }, [enabled, offset, onDismiss, reducedMotion, spatial, start, dragging, scroll, touchStart, pressAfter]);
}

function SheetHandle({ dismissible, onDismiss }: { dismissible: boolean; onDismiss: () => void }) {
  const { palette } = useTheme();
  return <PressableScale accessibilityRole="button" accessibilityLabel="Dismiss sheet" disabled={!dismissible}
    onPress={onDismiss} style={styles.sheetHandleTarget}>
    <View style={[styles.sheetHandle, { backgroundColor: palette.onSurfaceVariant }]} />
  </PressableScale>;
}

const styles = StyleSheet.create({
  confirmExtra: { width: "100%", alignItems: "center", gap: spacing[6], marginBottom: spacing[4] },
  root: { ...StyleSheet.absoluteFill },
  frame: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[16],
  },
  panel: {
    // Chrome walks the caret extra on Backspace when an <input> is inside
    // overflow:hidden + border-radius (especially with the caret in the
    // middle). Native still clips to the radius; web relies on padding.
    overflow: Platform.OS === "web" ? "visible" : "hidden",
    borderWidth: 0,
    flexShrink: 1,
    outlineWidth: 0,
    borderRadius: radius["3xl"],
  },
  sheetHandleTarget: { height: 48, alignItems: "center", justifyContent: "center" },
  sheetHandle: { width: 32, height: 4, borderRadius: radius.full },
  ghost: { opacity: 0 },
});
