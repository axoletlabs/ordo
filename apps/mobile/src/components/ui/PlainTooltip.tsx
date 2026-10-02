/** Material plain tooltip, kept out of the interaction and focus layers. */
import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useTheme } from "../../theme/ThemeProvider";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import { radius, spacing } from "../../theme/tokens";
import { OverlayPortal } from "./overlay-host";
import { Text } from "./Text";
export function PlainTooltip({ visible, anchor, label, onDismiss }: {
  visible: boolean; anchor: MenuAnchorRect | null; label: string; onDismiss: () => void;
}) {
  const { palette } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { rendered, progress } = useOverlayPresence(visible, onDismiss, { dismissKeyboard: false });
  const [size, setSize] = React.useState({ width: 0, height: 24 });
  const lastAnchor = React.useRef(anchor);
  if (anchor) lastAnchor.current = anchor;
  const origin = lastAnchor.current;
  const fade = useAnimatedStyle(() => ({ opacity: progress.value }));
  if (!rendered || !origin) return null;
  const w = size.width || Math.min(240, label.length * 7 + 16);
  const left = Math.max(insets.left + 8, Math.min(origin.x + origin.width / 2 - w / 2, width - insets.right - w - 8));
  const below = origin.y + origin.height + 8;
  const top = below + size.height <= height - insets.bottom - 8 ? below : Math.max(insets.top + 8, origin.y - size.height - 8);
  return <OverlayPortal><View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Animated.View role="tooltip" onLayout={(event) => setSize(event.nativeEvent.layout)}
      style={[styles.tooltip, { left, top, backgroundColor: palette.inverseSurface }, fade]}>
      <Text variant="bodySmall" style={{ color: palette.inverseOnSurface }}>{label}</Text>
    </Animated.View>
  </View></OverlayPortal>;
}
const styles = StyleSheet.create({
  tooltip: { position: "absolute", maxWidth: 240, paddingHorizontal: spacing[8], paddingVertical: spacing[4], borderRadius: radius.xs },
});
