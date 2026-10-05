import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { AppIcon } from "../ui/PinIcon";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { selectionActionLayout } from "../../lib/selection-action-layout";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { layout, radius, spacing } from "../../theme/tokens";
import { SELECTION_BAR_HEIGHT } from "../../hooks/use-selection";

export interface SelectionAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function SelectionActionBar({
  actions,
  bottom,
  maxWidth = layout.maxContentWidth,
}: {
  actions: readonly SelectionAction[];
  bottom: number;
  maxWidth?: number;
}) {
  const { palette, shadows, expressive } = useTheme();
  const { width } = useWindowDimensions();
  const column = useColumnPadding(maxWidth);
  const motion = useMaterialMotion();
  const [pressedKey, setPressedKey] = React.useState<string | null>(null);
  const retained = React.useRef(new Map<string, SelectionAction>());
  for (const action of actions) retained.current.set(action.key, action);
  const keys = [...retained.current.keys()];
  const available = Math.min(width, maxWidth) - column.left - column.right - 16;
  const target = selectionActionLayout(actions.map(action => action.key), available, pressedKey, !motion.reducedMotion);
  const geometry = keys.flatMap(key => [target[key]?.right ?? 0, target[key]?.width ?? 0]);
  const visibility = keys.map(key => target[key] ? 1 : 0);
  const positions = useSharedValue(geometry);
  const effects = useSharedValue<number[]>(visibility);
  const geometryKey = geometry.join(":");
  const visibilityKey = visibility.join(":");
  React.useEffect(() => {
    const next = geometryKey.split(":").map(Number);
    // New slots start collapsed; existing slots retarget from their live size.
    if (positions.value.length < next.length) positions.value = Array.from({ length: next.length / 2 }, (_, index) =>
      positions.value.slice(index * 2, index * 2 + 2).length ? positions.value.slice(index * 2, index * 2 + 2) : [next[index * 2]!, 0]).flat();
    positions.value = motion.reducedMotion ? next : withSpring(next, motion.fast);
  }, [geometryKey, positions, motion.fast, motion.reducedMotion]);
  React.useEffect(() => {
    const next = visibilityKey.split(":").map(Number);
    if (effects.value.length < next.length) effects.value = next.map((_, index) => effects.value[index] ?? 0);
    effects.value = motion.reducedMotion ? next : withSpring(next, materialMotion.effects.fast);
  }, [visibilityKey, effects, motion.reducedMotion]);
  if (actions.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={[
          styles.layer,
          {
            maxWidth,
            paddingBottom: bottom,
            paddingLeft: column.left,
            paddingRight: column.right,
          },
        ]}
      >
        <View
          style={[
            styles.bar,
            {
              backgroundColor: palette.surfaceContainerHigh,
              borderRadius: expressive ? radius["3xl"] : radius.full,
              ...shadows.level2,
            },
          ]}
        >
          <View style={{ height: 48, flex: 1 }}>
          {keys.map((key, index) => {
            const action = retained.current.get(key)!;
            const present = !!target[key];
            const color = action.danger ? palette.onErrorContainer : palette.onSecondaryContainer;
            const muted = action.disabled;
            return (
              <ActionSlot key={action.key} index={index} positions={positions} effects={effects} present={present}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={action.label}
                disabled={muted || !present}
                onPressIn={() => setPressedKey(action.key)}
                onPressOut={() => setPressedKey(null)}
                onPress={() => {
                  if (muted) return;
                  haptics.light();
                  action.onPress();
                }}
                stateLayerColor={color} shape={{ rest: 24, pressed: expressive ? radius.md : 24 }}
                hitSlop={4}
                style={[styles.action, { borderRadius: 24, backgroundColor: action.danger ? palette.errorContainer : palette.secondaryContainer }, muted && styles.disabled]}
              >
                <AppIcon name={action.icon} size={22} color={color} />
                <Text variant="labelSmall" style={{ color }} numberOfLines={1}>
                  {action.label}
                </Text>
              </PressableScale>
              </ActionSlot>
            );
          })}
          </View>
        </View>
      </View>
    </View>
  );
}

function ActionSlot({ index, positions, effects, present, children }: {
  index: number; positions: SharedValue<number[]>; effects: SharedValue<number[]>; present: boolean; children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => ({ right: positions.value[index * 2] ?? 0,
    width: Math.max(0, positions.value[index * 2 + 1] ?? 0), opacity: Math.max(0, Math.min(1, effects.value[index] ?? 0)) }));
  return <Animated.View pointerEvents={present ? "auto" : "none"} aria-hidden={!present}
    accessibilityElementsHidden={!present} importantForAccessibility={present ? "auto" : "no-hide-descendants"}
    style={[{ position: "absolute", height: 48, overflow: "hidden" }, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    justifyContent: "flex-end",
  },
  bar: {
    minHeight: SELECTION_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 0,
    borderRadius: radius["2xl"],
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[8],
  },
  action: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
    minHeight: 48,
  },
  disabled: { opacity: 0.4 },
});
