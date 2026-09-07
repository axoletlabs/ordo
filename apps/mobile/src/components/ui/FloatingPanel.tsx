import React from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeProvider";
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
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    requestAnimationFrame(() => {
      Animated.spring(progress, {
        toValue: 1,
        damping: 22,
        stiffness: 260,
        mass: 0.75,
        useNativeDriver: true,
      }).start();
    });
  }, [progress, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={onShow}
      onRequestClose={dismissible ? onDismiss : () => {}}
    >
      <View accessibilityViewIsModal style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]}
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
                backgroundColor: palette.surfaceElevated,
                borderColor: palette.borderStrong,
                ...shadows.level3,
                opacity: progress,
                transform: [
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
                ],
              },
              style,
            ]}
          >
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  frame: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[16],
  },
  panel: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius["2xl"],
    padding: spacing[12],
  },
});
