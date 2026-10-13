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
export function PlainTooltip({ id, visible, anchor, label, onDismiss, onHoverIn, onHoverOut }: {
   id?: string; visible: boolean; anchor: MenuAnchorRect | null; label: string; onDismiss: () => void;
   onHoverIn?: () => void; onHoverOut?: () => void;
}) {
  const { palette } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [size, setSize] = React.useState({ width: 0, height: 24 });
  const { rendered, progress } = useOverlayPresence(visible, onDismiss, { dismissKeyboard: false, ready: size.width > 0 });
  const lastAnchor = React.useRef(anchor);
  if (anchor) lastAnchor.current = anchor;
  const origin = lastAnchor.current;
  const lastLabel = React.useRef(label);
  if (visible) lastLabel.current = label;
  const fade = useAnimatedStyle(() => ({ opacity: progress.value }));
  if (!rendered || !origin) return null;
  const w = size.width || Math.min(240, label.length * 7 + 16);
  const left = Math.max(insets.left + 8, Math.min(origin.x + origin.width / 2 - w / 2, width - insets.right - w - 8));
  const below = origin.y + origin.height + 8;
  const top = below + size.height <= height - insets.bottom - 8 ? below : Math.max(insets.top + 8, origin.y - size.height - 8);
   return <OverlayPortal><View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
     <Animated.View nativeID={id} role="tooltip" onPointerEnter={onHoverIn} onPointerLeave={onHoverOut} onLayout={(event) => setSize(event.nativeEvent.layout)}
      style={[styles.tooltip, { left, top, backgroundColor: palette.inverseSurface }, fade]}>
       <Text variant="bodySmall" style={{ color: palette.inverseOnSurface }}>{visible ? label : lastLabel.current}</Text>
    </Animated.View>
  </View></OverlayPortal>;
}
const styles = StyleSheet.create({
  tooltip: { position: "absolute", maxWidth: 240, paddingHorizontal: spacing[8], paddingVertical: spacing[4], borderRadius: radius.xs },
});
