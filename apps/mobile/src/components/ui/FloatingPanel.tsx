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

function panelChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment
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
  onShow?: () => void;
  /** Size the card to its children instead of stretching toward `maxWidth`. */
  fitContent?: boolean;
  /** When false, the scrim and back button do not close the panel. */
  dismissible?: boolean;
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
}: FloatingPanelProps) {
  const { palette, expressive } = useTheme();
  const titleId = React.useId();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hideAndDismiss = React.useCallback(() => {
    if (!dismissible) return;
    dismissKeyboard();
    onDismiss();
  }, [dismissible, onDismiss]);
  const { rendered, progress, spatial } = useOverlayPresence(visible, hideAndDismiss);
  const panelRef = useOverlayFocus(visible && rendered, hideAndDismiss, "dialog", dismissible);
  const lastChildren = React.useRef(children);
  if (visible) lastChildren.current = children;
  const nodes = panelChildren(visible ? children : lastChildren.current);
  const headers = nodes.filter((node) => React.isValidElement(node) && node.type === PanelHeader);
  const actions = nodes.filter((node) => React.isValidElement(node) && node.type === PanelActions);
  const body = nodes.filter((node) => !headers.includes(node) && !actions.includes(node));
  const heightLimit = height - insets.top - insets.bottom - spacing[48];
  const bodyLimit = Math.max(0, heightLimit - layout.overlayPadding * 2 - (headers.length ? 56 : 0) - (actions.length ? 72 : 0));
  const scrollingBody = body.length === 1 && React.isValidElement<{ style?: StyleProp<ViewStyle> }>(body[0]) && body[0].type === ThemedScrollView
    ? React.cloneElement(body[0], { style: [body[0].props.style, { flexShrink: 1, maxHeight: bodyLimit }] })
    : body.length ? <ThemedScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1, maxHeight: bodyLimit }}>{body}</ThemedScrollView> : null;

  React.useEffect(() => {
    if (visible) onShow?.();
  }, [onShow, visible]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  // Opacity only: a transform on this card (even translateY(0)) puts every
  // nested <input> in a containing transform, and browsers then walk the
  // caret one character off on Backspace. ThemedScrollView strips RN-web's
  // translateZ(0) for the same reason.
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    ...(Platform.OS === "web" ? {} : { transform: [{ translateY: (1 - spatial.value) * 24 }, { scale: 0.94 + spatial.value * 0.06 }] }),
  }));

  if (!rendered) return null;

  return (
    <OverlayPortal>
      <View
        accessibilityViewIsModal={visible}
        pointerEvents={visible ? "auto" : "none"}
        style={styles.root}
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
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={styles.frame}
        >
          <Animated.View
            ref={panelRef}
            role="dialog"
            aria-modal={visible}
            aria-hidden={!visible}
            aria-labelledby={titleId}
            accessibilityLabel={React.Children.toArray(children).map((child) => React.isValidElement(child) ? (child.props as { title?: string }).title : undefined).find(Boolean)}
            accessibilityViewIsModal
            {...(Platform.OS === "web" ? { tabIndex: -1, dataSet: { materialOverlay: visible ? "true" : "false" } } : {})}
            style={[
              styles.panel,
              {
                width: fitContent ? undefined : Math.min(maxWidth, width - spacing[32]),
                maxWidth: Math.min(maxWidth, width - spacing[32]),
                padding: layout.overlayPadding,
                minWidth: fitContent ? 220 : undefined,
                maxHeight: heightLimit,
                backgroundColor: palette.surfaceContainerHigh,
                borderRadius: expressive ? radius["3xl"] : radius["2xl"],
              },
              panelStyle,
              style,
            ]}
          >
            <PanelTitleContext.Provider value={titleId}>{headers}{scrollingBody}{actions}</PanelTitleContext.Provider>
          </Animated.View>
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
