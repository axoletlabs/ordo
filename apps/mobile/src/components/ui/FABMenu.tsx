/** Expressive native FAB menu; Material specifies an anchored menu on web. */
import React from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContextMenu, ContextMenuItem, type MenuAnchorRect } from "./ContextMenu";
import { MaterialIcon } from "./MaterialIcon";
import { OverlayPortal } from "./overlay-host";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { ThemedScrollView } from "./ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { useSurfaceSize } from "../../hooks/use-surface-size";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useScrimPress } from "../../hooks/use-scrim-press";
import { haptics } from "../../lib/haptics";
import { radius, spacing } from "../../theme/tokens";

export interface FABMenuAction {
  label: string;
  icon: keyof typeof MaterialIcon.glyphMap;
  onPress: () => void;
}
interface FABMenuProps {
  visible: boolean;
  anchor: MenuAnchorRect | null;
  onDismiss: () => void;
  actions: readonly FABMenuAction[];
}

export function FABMenu(props: FABMenuProps) {
  const { expressive } = useTheme();
  return expressive && Platform.OS !== "web" ? <NativeFABMenu {...props} />
    : <ContextMenu visible={props.visible} anchor={props.anchor} onDismiss={props.onDismiss}>
      {props.actions.map(action => <ContextMenuItem key={action.label} {...action}
        onPress={() => { props.onDismiss(); action.onPress(); }} />)}
    </ContextMenu>;
}

function NativeFABMenu({ visible, anchor, onDismiss, actions }: FABMenuProps) {
  const { palette, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { rendered, progress, spatial } = useOverlayPresence(visible, onDismiss);
  const scrimPress = useScrimPress(visible, onDismiss);
  // Keep both actions and the measured origin painted throughout dismissal.
  const retained = React.useRef({ anchor, actions });
  if (visible) retained.current = { anchor, actions };
  const origin = retained.current.anchor;
  const closeTop = Math.max(insets.top + 8, Math.min(origin?.y ?? height - insets.bottom - 72, height - insets.bottom - 64));
  const trailing = Math.max(insets.right + 16, width - ((origin?.x ?? width - 72) + (origin?.width ?? 56)));
  const menuHeight = Math.max(0, closeTop - insets.top - 24);
  const [contentHeight, setContentHeight] = React.useState<number | null>(null);
  const size = useSurfaceSize(contentHeight == null ? null : Math.min(menuHeight, contentHeight), {
    active: visible,
    geometryKey: `${width}:${height}:${insets.top}:${insets.bottom}`,
  });
  const fade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const movement = useAnimatedStyle(() => ({ opacity: progress.value,
    transform: [{ translateY: (1 - spatial.value) * 48 }] }));
  const closeRotation = useAnimatedStyle(() => ({ transform: [{ rotate: `${(1 - spatial.value) * -45}deg` }] }));
  if (!rendered || !origin) return null;
  return <OverlayPortal blocking active={visible}>
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}
      accessibilityViewIsModal={visible} accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `${palette.scrim}52` }, fade]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss create menu" style={StyleSheet.absoluteFill} {...scrimPress} />
      <Animated.View testID="material-fab-menu" style={[styles.items, {
        // Account for the scroll content's shadow gutter so painted trailing
        // edges align with the close button, with a 16dp gap above it.
        right: trailing - spacing[4], bottom: height - closeTop + spacing[12], maxHeight: menuHeight,
        maxWidth: Math.max(0, width - trailing - insets.left - spacing[12]),
      }, movement, size]}>
        <ThemedScrollView bounces={false} contentContainerStyle={styles.itemContent}
          onContentSizeChange={(_width, next) => setContentHeight(current => current != null && Math.abs(current - next) < 0.5 ? current : next)}>
          {retained.current.actions.map(action => <PressableScale key={action.label}
            accessibilityRole="button" accessibilityLabel={action.label}
            stateLayerColor={palette.onPrimaryContainer}
            style={[styles.item, { backgroundColor: palette.primaryContainer }, shadows.level3]}
            onPress={() => { haptics.light(); onDismiss(); action.onPress(); }}>
            <Text variant="titleMedium" style={{ flexShrink: 1, color: palette.onPrimaryContainer }}>{action.label}</Text>
            <MaterialIcon name={action.icon} size={24} color={palette.onPrimaryContainer} />
          </PressableScale>)}
        </ThemedScrollView>
      </Animated.View>
      <Animated.View style={[styles.close, { position: "absolute", top: closeTop, right: trailing }, fade]}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Close create menu"
          stateLayerColor={palette.onPrimary} onPress={onDismiss}
          style={[styles.close, { backgroundColor: palette.primary }, shadows.level3]}>
          <Animated.View style={closeRotation}><MaterialIcon name="close" size={24} color={palette.onPrimary} /></Animated.View>
        </PressableScale>
      </Animated.View>
    </View>
  </OverlayPortal>;
}

const styles = StyleSheet.create({
  items: { position: "absolute", flexShrink: 1 },
  itemContent: { alignItems: "flex-end", gap: spacing[8], padding: spacing[4] },
  item: { minHeight: 56, maxWidth: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing[12], paddingHorizontal: spacing[24], paddingVertical: spacing[16], borderRadius: radius.full },
  close: { width: 56, height: 56, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
});
