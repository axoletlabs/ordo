import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
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
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  maxWidth?: number;
  onShow?: () => void | ReturnType<typeof setTimeout> | (() => void);
  /** Size the card to its children instead of stretching toward `maxWidth`. */
  fitContent?: boolean;
  /** When false, the scrim and back button do not close the panel. */
  dismissible?: boolean;
  /** Pickers own their virtualized list; don't nest it inside a ScrollView. */
  scrollBody?: boolean;
  /** Keep a draft mounted while a sibling picker is the active surface. */
  obscured?: boolean;
}

export function FloatingPanel({
  visible,
  onDismiss,
  children,
  style,
  maxWidth = layout.overlayMaxWidth,
  onShow,
  fitContent = false,
  dismissible = true,
  scrollBody = true,
  obscured = false,
}: FloatingPanelProps) {
  const { palette, expressive } = useTheme();
  const titleId = React.useId();
  const onShowRef = React.useRef(onShow);
  onShowRef.current = onShow;
  const { width, height } = useWindowDimensions();
  const [availableHeight, setAvailableHeight] = React.useState(height);
  const insets = useSafeAreaInsets();
  const hideAndDismiss = React.useCallback(() => {
    if (!dismissible) return;
    dismissKeyboard();
    onDismiss();
  }, [dismissible, onDismiss]);
  const { rendered, progress, spatial } = useOverlayPresence(visible, hideAndDismiss, { interactive: !obscured });
  const panelRef = useOverlayFocus(visible && !obscured && rendered, hideAndDismiss, "dialog", dismissible);
  const lastChildren = React.useRef(children);
  if (visible) lastChildren.current = children;
  const nodes = panelChildren(visible ? children : lastChildren.current);
  const headers = nodes.filter((node) => React.isValidElement(node) && node.type === PanelHeader);
  const actions = nodes.filter((node) => React.isValidElement(node) && node.type === PanelActions);
  const body = nodes.filter((node) => !headers.includes(node) && !actions.includes(node));
  const heightLimit = Math.max(80, Math.min(height, availableHeight) - insets.top - insets.bottom - spacing[32]);
  const panelPadding = heightLimit < 480 ? spacing[16] : layout.overlayPadding;
  // In short windows/above the IME, let the title scroll with the content so
  // long confirmations cannot push their actions out of the visible panel.
  const scrollHeader = heightLimit < 360;
  const scrollAll = scrollBody && heightLimit < 220;
  const bodyLimit = Math.max(0, heightLimit - panelPadding * 2 - (!scrollHeader && headers.length ? 56 : 0) - (!scrollAll && actions.length ? 72 : 0));
  const scrollNodes = scrollHeader ? [...headers.map((header) => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
     ? React.cloneElement(header, { style: [header.props.style, { marginBottom: body.length ? spacing[24] : 0 }] }) : header), ...body, ...(scrollAll ? actions : [])] : body;
  const scrollingBody = !scrollNodes.length ? null : scrollBody
    ? <ThemedScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ flexShrink: 1, maxHeight: bodyLimit }}>{scrollNodes}</ThemedScrollView>
    : <View style={{ flexShrink: 1, maxHeight: bodyLimit }}>{scrollNodes}</View>;

  React.useEffect(() => {
    if (!visible) return;
    const cleanup = onShowRef.current?.();
    return () => {
      if (typeof cleanup === "function") cleanup();
      else if (cleanup != null) clearTimeout(cleanup);
    };
  }, [visible]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  // Web keeps its input ancestors untransformed/unclipped. Fade a separate
  // clipped surface and the contents, rather than compositing the entire
  // rounded panel (which leaves a square backing in Chromium).
  const panelStyle = useAnimatedStyle(() => Platform.OS === "web" ? {} : ({
    opacity: progress.value,
    transform: [{ translateY: (1 - spatial.value) * 24 }, { scale: 0.94 + spatial.value * 0.06 }],
  }));

  if (!rendered) return null;

  return (
    <OverlayPortal>
      <View
        accessibilityViewIsModal={visible && !obscured}
        importantForAccessibility={obscured ? "no-hide-descendants" : "auto"}
        aria-hidden={!visible || obscured}
        pointerEvents={visible && !obscured ? "auto" : "none"}
        style={[styles.root, obscured ? { display: "none" } : null]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} />
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={StyleSheet.absoluteFill}
          onPressIn={dismissible ? dismissKeyboard : undefined}
          onPress={dismissible ? hideAndDismiss : undefined}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "web" ? undefined : "padding"}
          pointerEvents="box-none"
          style={{ flex: 1 }}
        >
          <View pointerEvents="box-none" style={[styles.frame, { paddingTop: insets.top + spacing[16], paddingBottom: insets.bottom + spacing[16] }]}
            onLayout={(event) => { const next = event.nativeEvent.layout.height; if (!obscured && next > 0) setAvailableHeight((current) => Math.abs(current - next) < 1 ? current : next); }}>
          <Animated.View
            ref={panelRef}
            role="dialog"
            aria-modal={visible}
            aria-hidden={!visible}
            aria-labelledby={titleId}
            accessibilityLabel={headers.map((child) => React.isValidElement(child) ? (child.props as { title?: string }).title : undefined).find(Boolean)}
            accessibilityLabelledBy={titleId}
            accessibilityViewIsModal
            {...(Platform.OS === "web" ? { tabIndex: -1, dataSet: { materialOverlay: visible ? "true" : "false" } } : {})}
            style={[
              styles.panel,
              {
                width: fitContent ? undefined : Math.min(maxWidth, width - spacing[32]),
                maxWidth: Math.min(maxWidth, width - spacing[32]),
                padding: panelPadding,
                minWidth: fitContent ? 220 : undefined,
                maxHeight: heightLimit,
                backgroundColor: Platform.OS === "web" ? "transparent" : palette.surfaceContainerHigh,
                borderRadius: expressive ? radius["3xl"] : radius["2xl"],
              },
              panelStyle,
              style,
            ]}
          >
            {/* A separate web surface avoids the square compositing fringe on
                opacity-animated rounded cards without clipping input carets. */}
            {Platform.OS === "web" ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
              backgroundColor: palette.surfaceContainerHigh,
              borderRadius: expressive ? radius["3xl"] : radius["2xl"],
              zIndex: "auto",
              isolation: "auto",
              overflow: "hidden",
            } as unknown as ViewStyle, scrimStyle]} /> : null}
            <Animated.View style={[{ flexShrink: 1 }, Platform.OS === "web" ? scrimStyle : null]}>
            <PanelTitleContext.Provider value={titleId}>
            <InputSurfaceContext.Provider value={palette.surfaceContainerHigh}>
              {!scrollHeader ? headers.map((header) => React.isValidElement<{ style?: StyleProp<ViewStyle> }>(header)
                ? React.cloneElement(header, { style: [header.props.style, { marginBottom: 0 }] }) : header) : null}
              {scrollingBody ? <View style={{ flexShrink: 1, marginTop: !scrollHeader && headers.length ? spacing[24] : 0 }}>{scrollingBody}</View> : null}{!scrollAll ? actions : null}
            </InputSurfaceContext.Provider>
            </PanelTitleContext.Provider>
            </Animated.View>
          </Animated.View>
          </View>
        </KeyboardAvoidingView>
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
});
