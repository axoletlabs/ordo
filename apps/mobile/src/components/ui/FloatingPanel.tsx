import React from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
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
import { ResizeOwnerContext } from "./resize-owner";
import { PanelTitleContext } from "./panel-title";
import { PanelPresenceContext } from "./panel-presence";
import { PanelHeader } from "./PanelHeader";
import { PanelActions } from "./SheetActionRow";
import { ThemedScrollView } from "./ThemedScrollView";
import { InputSurfaceContext } from "./input-surface";
import { InputFocusScopeContext, useInputFocusScope } from "./input-focus-scope";
import { panelKeyboardLift } from "../../lib/panel-keyboard-layout";
import { useMaterialMotion } from "../../theme/material-motion";
import { PressableScale } from "./PressableScale";

function panelChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && (child.type === React.Fragment || child.type === ThemedScrollView)
      ? panelChildren(child.props.children) : [child]);
}
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import { layout, radius, spacing } from "../../theme/tokens";

/** Native layout should report in the first frame; see the fallback below. */
const READY_FALLBACK_MS = 200;

export interface FloatingPanelProps {
  visible: boolean;
  onDismiss: () => void;
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
  presentation?: "dialog" | "bottom-sheet";
  /** Adaptive sheets animate their height to fit the content, keeping actions
   * anchored at the bottom. Expanded sheets always use the height limit. */
  sheetSizing?: "content" | "expanded" | "adaptive";
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

export function FloatingPanel(props: FloatingPanelProps) {
  const [activated, setActivated] = React.useState(props.visible);
  if (props.visible && !activated) setActivated(true);
  if (!activated && !props.keepMounted) return null;
  return props.pageKey != null ? <PagedFloatingPanelSurface {...props} pageKey={props.pageKey} /> : <FloatingPanelSurface {...props} />;
}

function PagedFloatingPanelSurface(props: FloatingPanelProps & { pageKey: string }) {
  // Measure the incoming page as soon as its content and scroll ownership commit.
  const page = useOverlayPage(props.visible, props.pageKey, { children: props.children, scrollBody: props.scrollBody });
  return <FloatingPanelSurface {...props} scrollBody={page.content.scrollBody}
    pageStyle={page.style}>{page.content.children}</FloatingPanelSurface>;
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
  onShow,
  fitContent = false,
  dismissible = true,
  dismissOnScrim = true,
  scrollBody = true,
  scrollResetKey,
  keepMounted = false,
  obscured = false,
  interactive = true,
  pageStyle,
}: FloatingPanelProps & { pageStyle?: ReturnType<typeof useOverlayPage>["style"] }) {
  const { palette } = useTheme();
  const sheet = presentation === "bottom-sheet";
  const expandedSheet = sheet && sheetSizing === "expanded";
  const adaptiveSheet = sheet && sheetSizing !== "expanded";
  const fillSheet = expandedSheet || adaptiveSheet;
  const panelSurface = sheet ? palette.surfaceContainerLow : palette.surfaceContainerHigh;
  const titleId = React.useId();
  const onShowRef = React.useRef(onShow);
  React.useLayoutEffect(() => { onShowRef.current = onShow; }, [onShow]);
  const { width, height } = useWindowDimensions();
  const [availableHeight, setAvailableHeight] = React.useState(height);
  const [keyboardTop, setKeyboardTop] = React.useState<number | null>(null);
  const [naturalContentHeight, setNaturalContentHeight] = React.useState<number | null>(null);
  const [sheetHeaderHeight, setSheetHeaderHeight] = React.useState(0);
  const [sheetActionsHeight, setSheetActionsHeight] = React.useState(0);
  const [sheetBodyHeight, setSheetBodyHeight] = React.useState<number | null>(null);
  const adaptiveReady = !adaptiveSheet || (sheetBodyHeight != null && sheetHeaderHeight > 0 && sheetActionsHeight > 0);
  const [measured, setMeasured] = React.useState(false);
  const dragOffset = useSharedValue(0);
  const resting = React.useRef({ width, height });
  if (width !== resting.current.width || Platform.OS === "web") resting.current = { width, height };
  else resting.current.height = Math.max(resting.current.height, height);
  const restHeight = resting.current.height;
  const motion = useMaterialMotion();
  const keyboardShift = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const hideAndDismiss = React.useCallback(() => {
    if (!dismissible) return;
    dismissKeyboard();
    onDismiss();
  }, [dismissible, onDismiss]);
  const scrimPress = useScrimPress(visible && interactive && !obscured && dismissOnScrim, hideAndDismiss);
  const { rendered, progress, spatial } = useOverlayPresence(visible, hideAndDismiss, {
    interactive: interactive && !obscured, onEntered, onExited, onExiting, ready: (Platform.OS === "web" || measured) && adaptiveReady && (fillSheet || naturalContentHeight != null),
  });
  React.useEffect(() => {
    if (!rendered && !keepMounted) { setMeasured(false); setNaturalContentHeight(null); }
  }, [rendered, keepMounted]);
  // A layout report should arrive in the first frame. If it never does,
  // release the entrance instead of keeping an invisible, blocking dialog.
  React.useEffect(() => {
    if (!visible || (Platform.OS === "web" || measured) && (fillSheet || naturalContentHeight != null)) return;
    const timer = setTimeout(() => {
      setMeasured(true);
      setNaturalContentHeight(current => current ?? 0);
    }, READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [visible, measured, fillSheet, naturalContentHeight]);
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
  const fittedSheetHeight = Math.min(heightLimit, sheetHeaderHeight + sheetActionsHeight + (sheetBodyHeight ?? 0) + spacing[24] * 2);
  const adaptiveSizeStyle = useSurfaceSize(adaptiveSheet ? adaptiveReady ? fittedSheetHeight : heightLimit : null, {
    active: visible && !obscured && adaptiveReady,
    geometryKey: `${width}:${height}:${keyboardTop}:${heightLimit}:${insets.top}:${insets.bottom}`,
  });
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
  const fittedContentHeight = !fillSheet && naturalContentHeight != null
    ? Math.min(heightLimit, naturalContentHeight + Number(topPadding) + Number(bottomPadding)) : null;
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
    setNaturalContentHeight(current => current != null && Math.abs(current - next) < 0.5 ? current : next);
  }, [obscured]);

  React.useLayoutEffect(() => {
    if (!visible) return;
    dragOffset.value = 0;
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

  const previousLift = React.useRef({ lift: 0, reducedMotion: motion.reducedMotion });
  React.useEffect(() => {
    // Browser layout already follows its visual viewport; no keyboard worklet.
    if (Platform.OS === "web") return;
    const center = (restHeight + insets.top - insets.bottom) / 2;
    const lift = sheet ? Math.min(0, viewportHeight - restHeight)
      : panelKeyboardLift(center, fittedContentHeight ?? 0, viewportHeight, insets.top + spacing[16], bottomInset + spacing[16]);
    if (previousLift.current.lift === lift && previousLift.current.reducedMotion === motion.reducedMotion) return;
    previousLift.current = { lift, reducedMotion: motion.reducedMotion };
    keyboardShift.value = withTiming(lift, { duration: motion.reducedMotion ? 0 : 250, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [restHeight, fittedContentHeight, viewportHeight, insets.top, insets.bottom, bottomInset, keyboardShift, motion.reducedMotion, sheet]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * obscuredFade.value,
  }));
  // Web keeps its input ancestors untransformed/unclipped. Fade a separate
  // clipped surface and the contents, rather than compositing the entire
  // rounded panel (which leaves a square backing in Chromium).
  const panelStyle = useAnimatedStyle(() => sheet ? {
    opacity: progress.value * obscuredFade.value,
    transform: [{ translateY: keyboardShift.value + Math.max(0, 1 - spatial.value) * heightLimit + dragOffset.value }],
  } : Platform.OS === "web" ? {} : ({
    opacity: progress.value * obscuredFade.value,
    transform: [{ translateY: keyboardShift.value + (1 - spatial.value) * 24 }, ...(Platform.OS === "ios" ? [{ scale: 0.94 + spatial.value * 0.06 }] : [])],
  }));

  const inputFocusScope = useInputFocusScope(visible && rendered && interactive && !obscured,
    (Platform.OS === "web" || measured) && (fillSheet || naturalContentHeight != null), visible);
  const presenceScope = React.useMemo(() => ({ visible, rendered }), [visible, rendered]);

  if (!rendered && !keepMounted) return null;

  const sheetHeader = <View testID="material-sheet-header" onLayout={(event) => setSheetHeaderHeight(event.nativeEvent.layout.height)}
    style={{ backgroundColor: panelSurface }}>
    <SheetHandle enabled={dismissible && visible && interactive && !obscured} dismissible={dismissible}
      onDismiss={hideAndDismiss} dragOffset={dragOffset} />
    <View style={{ paddingHorizontal: sheetInset, paddingBottom: spacing[8] }}>
      {headers.map((header) => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
        ? React.cloneElement(header, { style: [header.props.style, { marginBottom: 0 }] }) : header)}
    </View>
  </View>;
  const sheetActions = <View testID="material-sheet-actions" onLayout={(event) => setSheetActionsHeight(event.nativeEvent.layout.height)}
    style={{ paddingHorizontal: sheetInset, paddingBottom: Math.max(spacing[16], bottomInset),
      backgroundColor: panelSurface }}>
    {actions.map((action) => React.isValidElement<React.ComponentProps<typeof PanelActions>>(action)
      ? React.cloneElement(action, { topSpacing: 16 }) : action)}
  </View>;
  const sheetBodyPadding = { paddingHorizontal: sheetInset, paddingVertical: spacing[24] };
  const sheetBodyStyle = { flex: fillSheet ? 1 : undefined, flexShrink: 1,
    maxHeight: Math.max(0, heightLimit - sheetHeaderHeight - sheetActionsHeight), backgroundColor: panelSurface };
  // Measure natural content, independently of the animated scroll viewport.
  // A viewport measurement here would feed the height animation back into
  // itself and make short notes collapse or oscillate while switching.
  const sheetBody = adaptiveSheet ? <View style={{ flexShrink: 0 }} onLayout={(event) => setSheetBodyHeight(event.nativeEvent.layout.height)}>{body}</View> : body;
  // In extremely short windows/above a keyboard, scroll the whole sheet
  // rather than letting its fixed chrome hide the notes or dismissal action.
  const sheetScrollAll = scrollBody && (heightLimit < 280
    || fillSheet && heightLimit - sheetHeaderHeight - sheetActionsHeight < spacing[96]);
  const sheetContent = sheetScrollAll
    ? <ThemedScrollView key={scrollResetKey} testID="material-sheet-body" keyboardShouldPersistTaps="handled" nestedScrollEnabled
        style={{ flex: fillSheet ? 1 : undefined, flexShrink: 1, maxHeight: heightLimit, backgroundColor: panelSurface }}>
        {sheetHeader}<View style={sheetBodyPadding}>{sheetBody}</View>{sheetActions}
      </ThemedScrollView>
    : <>{sheetHeader}
        {scrollBody ? fillSheet ? <View style={sheetBodyStyle}>
          <ThemedScrollView key={scrollResetKey} testID="material-sheet-body" keyboardShouldPersistTaps="handled" nestedScrollEnabled
            style={{ flex: 1 }} contentContainerStyle={sheetBodyPadding}>{sheetBody}</ThemedScrollView>
          <SheetScrollFades color={panelSurface} />
        </View> : <ThemedScrollView key={scrollResetKey} testID="material-sheet-body" keyboardShouldPersistTaps="handled" nestedScrollEnabled
          style={sheetBodyStyle} contentContainerStyle={sheetBodyPadding}>{body}</ThemedScrollView>
          : <View testID="material-sheet-body" style={[sheetBodyStyle, sheetBodyPadding]}>{sheetBody}</View>}
        {sheetActions}
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
            onLayout={Platform.OS === "web" ? undefined : (event) => {
              const next = event.nativeEvent.layout.height;
              // Sizing already follows the independent content measurement.
              // Do not publish every frame of the height spring back to React.
              if (!measured && next > 0) setMeasured(true);
            }}
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
                height: fillSheet ? heightLimit : undefined,
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
            } as unknown as ViewStyle, scrimStyle]} /> : null}
            <ResizeOwnerContext.Provider value>
            <PanelTitleContext.Provider value={titleId}>
            <InputSurfaceContext.Provider value={panelSurface}>
            {sheet ? <Animated.View style={[{ flex: 1 }, Platform.OS === "web" ? scrimStyle : null]}>
              <PanelPageContent style={pageStyle}>{sheetContent}</PanelPageContent>
            </Animated.View> : <DialogContent headers={headers} actions={actions} body={body}
              scrollHeader={scrollHeader} scrollAll={scrollAll} scrollBody={scrollBody}
              scrollResetKey={scrollResetKey} heightLimit={Math.max(0, heightLimit - Number(topPadding) - Number(bottomPadding))}
              onMeasure={recordNaturalHeight} style={pageStyle} fade={Platform.OS === "web" ? scrimStyle : undefined} />}
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

/** The body reports its intrinsic content size independently of its viewport.
 * Header and actions participate in the CURRENT animated height, so actions
 * never land outside the card while its target size is still being reached. */
function DialogContent({ headers, actions, body, scrollHeader, scrollAll, scrollBody,
  scrollResetKey, heightLimit, onMeasure, style, fade }: {
  headers: React.ReactNode[]; actions: React.ReactNode[]; body: React.ReactNode[];
  scrollHeader: boolean; scrollAll: boolean; scrollBody: boolean;
  scrollResetKey?: string; heightLimit: number; onMeasure: (height: number) => void;
  style?: ReturnType<typeof useOverlayPage>["style"];
  fade?: ReturnType<typeof useOverlayPage>["style"];
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
  return <Animated.View testID="material-dialog-content" style={[{ flex: 1, minHeight: 0 }, fade, style]}>
    {fixedHeader ? <View style={{ flexShrink: 0 }} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      {headers.map(header => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
        ? React.cloneElement(header, { style: [header.props.style, { marginBottom: 0 }] }) : header)}
    </View> : null}
    <View testID="material-dialog-body" style={{ flex: 1, minHeight: 0, marginTop: gap, overflow: "hidden" }}>
      {scrollBody ? <ThemedScrollView key={scrollResetKey} keyboardShouldPersistTaps="handled" nestedScrollEnabled
        style={{ flex: 1 }} onContentSizeChange={(_width, next) => recordBody(next)}>{content}</ThemedScrollView>
        : <View style={{ flexShrink: 0, maxHeight: bodyLimit }} onLayout={event => recordBody(event.nativeEvent.layout.height)}>{content}</View>}
    </View>
    {fixedActions ? <View testID="material-dialog-actions" style={{ flexShrink: 0 }}>
      <View onLayout={event => setActionsHeight(event.nativeEvent.layout.height)}>{actions}</View>
    </View> : null}
  </Animated.View>;
}

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

/** Ordinary panels keep their original layout tree. Only paged dialogs need
 * a content fade independent of the persistent surface and backdrop. */
function PanelPageContent({ style, children }: {
  style?: ReturnType<typeof useOverlayPage>["style"];
  children: React.ReactNode;
}) {
  return style ? <Animated.View
    style={[{ flex: 1, minHeight: 0 }, style]}>{children}</Animated.View> : children;
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

/** Dialogs never allocate/register sheet gesture worklets. Only the handle
 * owns dismissal: dragging or selecting long notes stays with the scroller. */
function SheetHandle({ enabled, dismissible, onDismiss, dragOffset }: {
  enabled: boolean; dismissible: boolean; onDismiss: () => void; dragOffset: SharedValue<number>;
}) {
  const { palette } = useTheme();
  const { reducedMotion, spatial } = useMaterialMotion();
  const pressAfter = React.useRef(0);
  const beginDrag = React.useCallback(() => { pressAfter.current = Infinity; }, []);
  const endDrag = React.useCallback(() => {
    // RN Web may send a click after a pan, including a cancelled pan.
    if (pressAfter.current === Infinity) pressAfter.current = Date.now() + 200;
  }, []);
  const pan = React.useMemo(() => Gesture.Pan().enabled(enabled).activeOffsetY(8)
    .onStart(() => { runOnJS(beginDrag)(); })
    .onUpdate((event) => { dragOffset.value = Math.max(0, event.translationY); })
    .onEnd((event) => {
      if (event.translationY > 64 || (event.translationY > 8 && event.velocityY > 800)) runOnJS(onDismiss)();
      else dragOffset.value = reducedMotion ? 0 : withSpring(0, spatial);
    })
    .onFinalize((_event, success) => {
      runOnJS(endDrag)();
      if (!success) dragOffset.value = reducedMotion ? 0 : withSpring(0, spatial);
    }), [beginDrag, dragOffset, enabled, endDrag, onDismiss, reducedMotion, spatial]);
  return <GestureDetector gesture={pan}>
    <PressableScale accessibilityRole="button" accessibilityLabel="Dismiss sheet" disabled={!dismissible}
      onPress={() => { if (Date.now() >= pressAfter.current) onDismiss(); }} style={styles.sheetHandleTarget}>
      <View style={[styles.sheetHandle, { backgroundColor: palette.onSurfaceVariant }]} />
    </PressableScale>
  </GestureDetector>;
}

const styles = StyleSheet.create({
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
});
