import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View, useWindowDimensions } from "react-native";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { AppIcon } from "../ui/PinIcon";
import { StretchablePill } from "../ui/StretchablePill";
import { Text } from "../ui/Text";
import { useSelectionBarMotion, type SelectionPillMotion } from "../../hooks/use-selection-bar-motion";
import { type MeasureNode } from "../../lib/menu-anchor";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { layout, radius, spacing } from "../../theme/tokens";
import { SELECTION_BAR_HEIGHT } from "../../hooks/use-selection";

export interface SelectionAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Receives the pill's node so callers can anchor an overflow menu to it. */
  onPress: (trigger: MeasureNode | null) => void;
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
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const available = Math.min(width, maxWidth) - column.left - column.right - 16;
  const keys = actions.map(action => action.key);
  const motion = useSelectionBarMotion(keys, available, pressedKey);
  const retained = useRef(new Map<string, SelectionAction>());
  for (const action of actions) retained.current.set(action.key, action);
  const railRef = useRef<View | null>(null);
  const actionsKey = JSON.stringify(keys);
  useLayoutEffect(() => { if (!keys.includes(pressedKey ?? "")) setPressedKey(null); }, [actionsKey, pressedKey]);
  if (!motion.shown) return null;

  // Current actions lead accessibility order; departing actions cannot receive
  // touches or keyboard focus, even during the first frame after selection changes.
  const ordered = keys.length ? actions : motion.retainedKeys.map(key => retained.current.get(key)!);
  const containerStyle = { opacity: motion.containerOpacity, transform: [{ translateY: motion.containerShift }] };

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
        <Animated.View
          style={[
            styles.bar,
            {
              backgroundColor: palette.surfaceContainerHigh,
              borderRadius: expressive ? radius["3xl"] : radius.full,
              ...shadows.level2,
            },
            containerStyle,
          ]}
        >
          <View ref={railRef} style={styles.actions}>
            {ordered.map(action => <ActionSlot key={action.key} action={action} present={!keys.length || keys.includes(action.key)} exiting={!keys.length}
              pill={motion.values.get(action.key)!} canvasWidth={available} onPressed={setPressedKey}
              onPress={() => action.onPress({ measureInWindow: callback => railRef.current?.measureInWindow((x, y, _width, height) => {
                const target = motion.getTarget(action.key);
                if (target) callback(x + available - target.right - target.width, y, target.width, height);
              }) })} />)}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function ActionSlot({ action, present, exiting, pill, canvasWidth, onPressed, onPress }: {
  action: SelectionAction;
  present: boolean;
  exiting: boolean;
  pill: SelectionPillMotion;
  canvasWidth: number;
  onPressed: (key: string | null) => void;
  onPress: () => void;
}) {
  const { palette, expressive } = useTheme();
  const key = action.key;
  const shift = useMemo(() => Animated.multiply(pill.right, -1), [pill.right]);
  const slotStyle = { transform: [{ translateX: shift }] };
  const color = action.danger ? palette.onErrorContainer : palette.onSecondaryContainer;
  const interactive = present && !exiting;
  return <Animated.View pointerEvents={interactive ? "box-none" : "none"} aria-hidden={!interactive}
    accessibilityElementsHidden={!interactive} importantForAccessibility={interactive ? "auto" : "no-hide-descendants"}
    style={[styles.slot, { width: canvasWidth }, slotStyle]}>
    <StretchablePill width={pill.width} canvasWidth={canvasWidth} nativeGesture accessibilityRole="button" accessibilityLabel={action.label}
      accessibilityState={{ disabled: !!action.disabled || !interactive }} disabled={action.disabled || !interactive}
      onPressIn={() => onPressed(key)} onPressOut={() => onPressed(null)} onBlur={() => onPressed(null)}
      onPress={() => {
        if (!interactive || action.disabled) return;
        haptics.light();
        onPress();
      }}
      stateLayerColor={color} shape={{ rest: 24, pressed: expressive ? radius.md : 24 }}
      style={[styles.action, { backgroundColor: action.danger ? palette.errorContainer : palette.secondaryContainer }, action.disabled && styles.disabled]}>
      <AppIcon name={action.icon} size={22} color={color} />
      <Text variant="labelSmall" style={{ color }} numberOfLines={1}>{action.label}</Text>
    </StretchablePill>
  </Animated.View>;
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
  actions: { height: 48, flex: 1 },
  slot: { position: "absolute", right: 0, height: 48, borderRadius: 24 },
  action: {
    width: "100%",
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
    minHeight: 48,
  },
  disabled: { opacity: 0.4 },
});
