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
import { radius, spacing } from "../../theme/tokens";

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
  maxWidth = 420,
  onShow,
  fitContent = false,
  dismissible = true,
}: FloatingPanelProps) {
  const { palette, shadows } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { rendered, progress } = useOverlayPresence(visible, onDismiss);

  React.useEffect(() => {
    if (visible) onShow?.();
  }, [onShow, visible]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  // Opacity only: a transform on this card (even translateY(0)) puts every
  // nested <input> in a containing transform, and browsers then walk the
  // caret one character off on Backspace.
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  if (!rendered) return null;

  return (
    <OverlayPortal>
      <View accessibilityViewIsModal style={styles.root}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} />
        </Animated.View>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissible ? onDismiss : undefined}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={styles.frame}
        >
          <Animated.View
            style={[
              styles.panel,
              {
                width: fitContent ? undefined : Math.min(maxWidth, width - spacing[32]),
                maxWidth: Math.min(maxWidth, width - spacing[32]),
                minWidth: fitContent ? 220 : undefined,
                maxHeight: height - insets.top - insets.bottom - spacing[48],
                backgroundColor: palette.mode === "dark" ? palette.surfaceSecondary : palette.surfaceElevated,
                borderColor: palette.borderStrong,
                ...shadows.level3,
              },
              panelStyle,
              style,
            ]}
          >
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </OverlayPortal>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
  frame: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[16],
  },
  panel: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius["3xl"],
    padding: spacing[8],
  },
});
