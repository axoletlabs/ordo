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
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OverlayPortal } from "./overlay-host";
import { useTheme } from "../../theme/ThemeProvider";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useOverlayFocus } from "../../hooks/use-overlay-focus";
import { PanelTitleContext } from "./panel-title";
import { PanelHeader } from "./PanelHeader";
import { PanelActions } from "./SheetActionRow";
import { ThemedScrollView } from "./ThemedScrollView";
import { InputSurfaceContext } from "./input-surface";
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

export interface FloatingPanelProps {
  visible: boolean;
  onDismiss: () => void;
  onExited?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  maxWidth?: number;
  /** Bottom sheets reuse the dialog's focus, Back, and retained exit lifecycle. */
  presentation?: "dialog" | "bottom-sheet";
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
}

export function FloatingPanel(props: FloatingPanelProps) {
  const [activated, setActivated] = React.useState(props.visible);
  if (props.visible && !activated) setActivated(true);
  return activated || props.keepMounted ? <FloatingPanelSurface {...props} /> : null;
}

function FloatingPanelSurface({
  visible,
  onDismiss,
  onExited,
  children,
  style,
  maxWidth = layout.overlayMaxWidth,
  presentation = "dialog",
  onShow,
  fitContent = false,
  dismissible = true,
  dismissOnScrim = true,
  scrollBody = true,
  scrollResetKey,
  keepMounted = false,
  obscured = false,
  interactive = true,
}: FloatingPanelProps) {
  const { palette, expressive } = useTheme();
  const sheet = presentation === "bottom-sheet";
  const panelSurface = sheet ? palette.surfaceContainerLow : palette.surfaceContainerHigh;
  const titleId = React.useId();
  const onShowRef = React.useRef(onShow);
  onShowRef.current = onShow;
  const { width, height } = useWindowDimensions();
  const [availableHeight, setAvailableHeight] = React.useState(height);
  const [keyboardTop, setKeyboardTop] = React.useState<number | null>(null);
  const [panelHeight, setPanelHeight] = React.useState(0);
  const [sheetHeaderHeight, setSheetHeaderHeight] = React.useState(0);
  const [sheetActionsHeight, setSheetActionsHeight] = React.useState(0);
  const dragOffset = useSharedValue(0);
  const handlePressAfter = React.useRef(0);
  const beginHandleDrag = React.useCallback(() => { handlePressAfter.current = Infinity; }, []);
  const endHandleDrag = React.useCallback(() => {
    // RN Web can deliver a click after a pan ends. Don't interpret that
    // release as a second, tap-to-dismiss gesture (including cancelled pans).
    if (handlePressAfter.current === Infinity) handlePressAfter.current = Date.now() + 200;
  }, []);
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
  const { rendered, progress, spatial } = useOverlayPresence(visible, hideAndDismiss, { interactive: interactive && !obscured, onExited });
  const panelRef = useOverlayFocus(visible && rendered, hideAndDismiss, "dialog", dismissible, false, !interactive || obscured);
  // A sibling picker obscures this panel while staying mounted above it.
  // Crossfade this panel and its scrim (same 200ms inOut quad as the
  // picker's own fade, so the stacked scrims keep a constant dim) instead
  // of cutting to display:none; the display switch only happens after the
  // fade-out settles, and is lifted before fading back in.
  const obscuredFade = useSharedValue(obscured ? 0 : 1);
  const [collapsedObscured, setCollapsedObscured] = React.useState(obscured);
  const lastObscured = React.useRef(obscured);
  const finishObscuring = React.useCallback(() => {
    if (lastObscured.current) setCollapsedObscured(true);
  }, []);
  React.useLayoutEffect(() => {
    lastObscured.current = obscured;
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
  }, [obscured, obscuredFade, finishObscuring, motion.reducedMotion]);
  const lastChildren = React.useRef(children);
  if (visible) lastChildren.current = children;
  const nodes = panelChildren(visible ? children : lastChildren.current);
  const headers = nodes.filter((node) => React.isValidElement(node) && node.type === PanelHeader);
  const actions = nodes.filter((node) => React.isValidElement(node) && node.type === PanelActions);
  const body = nodes.filter((node) => !headers.includes(node) && !actions.includes(node));
  const viewportHeight = Math.min(height, availableHeight, keyboardTop ?? Infinity);
  const bottomInset = keyboardTop == null ? insets.bottom : 0;
  const heightLimit = sheet
    ? Math.max(80, Math.min(viewportHeight * 0.9, viewportHeight - insets.top - spacing[16]))
    : Math.max(80, viewportHeight - insets.top - bottomInset - spacing[32]);
  const sheetInset = width < 600 ? spacing[16] : spacing[24];
  const sheetWidth = Math.min(maxWidth, width - insets.left - insets.right);
  const corners = sheet ? {
    borderTopLeftRadius: expressive ? radius["3xl"] : radius["2xl"],
    borderTopRightRadius: expressive ? radius["3xl"] : radius["2xl"],
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  } : { borderRadius: expressive ? radius["3xl"] : radius["2xl"] };
  // Opening the keyboard must not also change the form's horizontal padding.
  const panelPadding = restHeight - insets.top - insets.bottom - spacing[32] < 480 ? spacing[16] : layout.overlayPadding;
  // In short windows/above the IME, let the title scroll with the content so
  // long confirmations cannot push their actions out of the visible panel.
  const scrollHeader = heightLimit < 360;
  const scrollAll = scrollBody && heightLimit < 220;
  const bodyLimit = Math.max(0, heightLimit - panelPadding * 2 - (!scrollHeader && headers.length ? 56 : 0) - (!scrollAll && actions.length ? 72 : 0));
  const scrollNodes = scrollHeader ? [...headers.map((header) => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
     ? React.cloneElement(header, { style: [header.props.style, { marginBottom: body.length ? spacing[24] : 0 }] }) : header), ...body, ...(scrollAll ? actions : [])] : body;
  const scrollingBody = !scrollNodes.length ? null : scrollBody
    ? <ThemedScrollView key={scrollResetKey} keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ flexShrink: 1, maxHeight: bodyLimit }}>{scrollNodes}</ThemedScrollView>
    : <View style={{ flexShrink: 1, maxHeight: bodyLimit }}>{scrollNodes}</View>;

  React.useEffect(() => {
    if (!visible || obscured || !interactive) return;
    const cleanup = onShowRef.current?.();
    return () => {
      if (typeof cleanup === "function") cleanup();
      else if (cleanup != null) clearTimeout(cleanup);
    };
  }, [visible, obscured, interactive]);

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

  React.useEffect(() => {
    const center = (restHeight + insets.top - insets.bottom) / 2;
    const lift = Platform.OS === "web" ? 0 : sheet ? Math.min(0, viewportHeight - restHeight)
      : panelKeyboardLift(center, panelHeight, viewportHeight, insets.top + spacing[16], bottomInset + spacing[16]);
    keyboardShift.value = withTiming(lift, { duration: motion.reducedMotion ? 0 : 250, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [restHeight, panelHeight, viewportHeight, insets.top, insets.bottom, bottomInset, keyboardShift, motion.reducedMotion, sheet]);

  // Only the handle owns dismissal gestures; dragging/selection in long notes
  // stays with their ScrollView. An incomplete drag springs back in place.
  const handlePan = Gesture.Pan().enabled(sheet && dismissible && visible && interactive && !obscured)
    .activeOffsetY(8)
    .onStart(() => { runOnJS(beginHandleDrag)(); })
    .onUpdate((event) => { dragOffset.value = Math.max(0, event.translationY); })
    .onEnd((event) => {
      if (event.translationY > 64 || (event.translationY > 8 && event.velocityY > 800)) runOnJS(hideAndDismiss)();
      else dragOffset.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
    })
    .onFinalize((_event, success) => {
      runOnJS(endHandleDrag)();
      if (!success) dragOffset.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
    });

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

  if (!rendered && !keepMounted) return null;

  const sheetHeader = <View testID="material-sheet-header" onLayout={(event) => setSheetHeaderHeight(event.nativeEvent.layout.height)}
    style={{ backgroundColor: panelSurface }}>
    <GestureDetector gesture={handlePan}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Dismiss sheet" disabled={!dismissible}
        onPress={() => { if (Date.now() >= handlePressAfter.current) hideAndDismiss(); }} style={styles.sheetHandleTarget}>
        <View style={[styles.sheetHandle, { backgroundColor: palette.onSurfaceVariant }]} />
      </PressableScale>
    </GestureDetector>
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
  const sheetBodyStyle = { flexShrink: 1, maxHeight: Math.max(0, heightLimit - sheetHeaderHeight - sheetActionsHeight), backgroundColor: panelSurface };
  // In extremely short windows/above a keyboard, scroll the whole sheet
  // rather than letting its fixed chrome hide the notes or dismissal action.
  const sheetScrollAll = scrollBody && heightLimit < 280;
  const sheetContent = sheetScrollAll
    ? <ThemedScrollView key={scrollResetKey} testID="material-sheet-body" keyboardShouldPersistTaps="handled" nestedScrollEnabled
        style={{ flexShrink: 1, maxHeight: heightLimit, backgroundColor: panelSurface }}>
        {sheetHeader}<View style={sheetBodyPadding}>{body}</View>{sheetActions}
      </ThemedScrollView>
    : <>{sheetHeader}
        {scrollBody ? <ThemedScrollView key={scrollResetKey} testID="material-sheet-body" keyboardShouldPersistTaps="handled" nestedScrollEnabled
          style={sheetBodyStyle} contentContainerStyle={sheetBodyPadding}>{body}</ThemedScrollView>
          : <View testID="material-sheet-body" style={[sheetBodyStyle, sheetBodyPadding]}>{body}</View>}
        {sheetActions}
      </>;

  return (
    <OverlayPortal blocking={rendered} active={visible && interactive && !obscured}>
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
        onLayout={(event) => { const next = event.nativeEvent.layout.height; if (!obscured && next > 0) setAvailableHeight((current) => Math.abs(current - next) < 1 ? current : next); }}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} />
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={StyleSheet.absoluteFill}
          onPressIn={dismissible && dismissOnScrim ? dismissKeyboard : undefined}
          onPress={dismissible && dismissOnScrim ? hideAndDismiss : undefined}
        />
          <View pointerEvents="box-none" style={[styles.frame, { paddingTop: insets.top + spacing[16], paddingBottom: insets.bottom + spacing[16] },
            sheet ? { justifyContent: "flex-end", paddingBottom: 0, paddingLeft: insets.left, paddingRight: insets.right } : null,
            Platform.OS !== "web" ? { flex: 0, height: restHeight } : null]}>
          <Animated.View
            ref={panelRef}
            onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
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
                width: sheet ? sheetWidth : fitContent ? undefined : Math.min(maxWidth, width - spacing[32]),
                maxWidth: sheet ? sheetWidth : Math.min(maxWidth, width - spacing[32]),
                padding: sheet ? 0 : panelPadding,
                minWidth: fitContent ? 220 : undefined,
                maxHeight: heightLimit,
                backgroundColor: Platform.OS === "web" ? "transparent" : panelSurface,
                ...corners,
                ...(sheet ? { overflow: "hidden" as const } : {}),
              },
              panelStyle,
              style,
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
            <Animated.View style={[{ flexShrink: 1 }, Platform.OS === "web" ? scrimStyle : null]}>
            <PanelTitleContext.Provider value={titleId}>
            <InputSurfaceContext.Provider value={panelSurface}>
              {sheet ? sheetContent : <>
              {!scrollHeader ? headers.map((header) => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
                ? React.cloneElement(header, { style: [header.props.style, { marginBottom: 0 }] }) : header) : null}
              {scrollingBody ? <View style={{ flexShrink: 1, marginTop: !scrollHeader && headers.length ? spacing[24] : 0 }}>{scrollingBody}</View> : null}{!scrollAll ? actions : null}
              </>}
            </InputSurfaceContext.Provider>
            </PanelTitleContext.Provider>
            </Animated.View>
          </Animated.View>
          </View>
      </View>
    </OverlayPortal>
  );
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
