import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View, useWindowDimensions } from "react-native";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { AppIcon } from "../ui/PinIcon";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
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

type Slot = {
  right: Animated.Value;
  width: Animated.Value;
  opacity: Animated.Value;
  content: SelectionAction;
  present: boolean;
  purge?: ReturnType<typeof setTimeout>;
};

const springTo = (value: Animated.Value, toValue: number, config: Record<string, unknown>, reducedMotion: boolean) => {
  if (reducedMotion) { value.setValue(toValue); return; }
  Animated.spring(value, { toValue, ...config, useNativeDriver: false, isInteraction: false }).start();
};

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
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const contents = useRef(new Map<string, SelectionAction>());
  for (const action of actions) contents.current.set(action.key, action);
  const slots = useRef(new Map<string, Slot>());
  const [, render] = useState(0);
  const available = Math.min(width, maxWidth) - column.left - column.right - 16;
  const target = selectionActionLayout(actions.map(action => action.key), available, pressedKey, !motion.reducedMotion);
  const latest = useRef({ actions, target });
  latest.current = { actions, target };

  // The bar fades/slides in when selection starts and back out when it ends,
  // instead of popping with the mount. It stays mounted through the exit.
  const visible = actions.length > 0;
  const [shown, setShown] = useState(visible);
  const containerOpacity = useRef(new Animated.Value(0)).current;
  const containerShift = useRef(new Animated.Value(12)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const actionsKey = actions.map(action => action.key).join(":");
  useEffect(() => {
    const { actions: currentActions, target: currentTarget } = latest.current;
    const run = () => {
      let changed = false;
      const current = new Set(currentActions.map(action => action.key));
      for (const action of currentActions) {
        const t = currentTarget[action.key]!;
        let slot = slots.current.get(action.key);
        if (!slot) {
          slot = { right: new Animated.Value(t.right),
            width: new Animated.Value(motion.reducedMotion ? Math.max(0, t.width) : 0),
            opacity: new Animated.Value(0), content: action, present: true };
          slots.current.set(action.key, slot);
          changed = true;
        } else {
          slot.content = action;
          if (!slot.present) {
            slot.present = true;
            if (slot.purge) clearTimeout(slot.purge);
            changed = true;
          }
        }
        springTo(slot.right, t.right, motion.fast, motion.reducedMotion);
        springTo(slot.width, Math.max(0, t.width), motion.fast, motion.reducedMotion);
        springTo(slot.opacity, 1, materialMotion.effects.fast, motion.reducedMotion);
      }
      for (const [key, slot] of [...slots.current]) if (!current.has(key) && slot.present) {
        slot.present = false;
        springTo(slot.opacity, 0, materialMotion.effects.fast, motion.reducedMotion);
        springTo(slot.width, 0, motion.fast, motion.reducedMotion);
        slot.purge = setTimeout(() => { slots.current.delete(key); render(n => n + 1); }, motion.reducedMotion ? 0 : 340);
        changed = true;
      }
      if (changed) render(n => n + 1);
    };
    run();
  }, [actionsKey, pressedKey, available, motion.fast, motion.reducedMotion]);

  useEffect(() => {
    if (visible) {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      setShown(true);
      springTo(containerOpacity, 1, materialMotion.effects.fast, motion.reducedMotion);
      springTo(containerShift, 0, motion.fast, motion.reducedMotion);
    } else if (shown) {
      springTo(containerOpacity, 0, materialMotion.effects.fast, motion.reducedMotion);
      springTo(containerShift, 12, motion.fast, motion.reducedMotion);
      hideTimer.current = setTimeout(() => setShown(false), motion.reducedMotion ? 0 : 240);
    }
  }, [visible, shown, containerOpacity, containerShift, motion.fast, motion.reducedMotion]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    for (const slot of slots.current.values()) if (slot.purge) clearTimeout(slot.purge);
  }, []);

  if (!shown) return null;

  // Current actions in bar order first (accessibility order), fading ghosts after.
  const ordered: Array<[string, Slot]> = [];
  for (const action of actions) { const slot = slots.current.get(action.key); if (slot) ordered.push([action.key, slot]); }
  for (const entry of slots.current) if (!entry[1].present) ordered.push(entry);

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
              opacity: containerOpacity,
              transform: [{ translateY: containerShift }],
              ...shadows.level2,
            },
          ]}
        >
          <View style={{ height: 48, flex: 1 }}>
          {ordered.map(([key, slot]) => {
            const action = contents.current.get(key) ?? slot.content;
            const present = slot.present;
            const color = action.danger ? palette.onErrorContainer : palette.onSecondaryContainer;
            const muted = action.disabled;
            return (
              <Animated.View key={key} pointerEvents={present ? "auto" : "none"} aria-hidden={!present}
                accessibilityElementsHidden={!present} importantForAccessibility={present ? "auto" : "no-hide-descendants"}
                style={[{ position: "absolute", height: 48, overflow: "hidden", borderRadius: 24 },
                  { right: slot.right, width: slot.width, opacity: slot.opacity }]}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={action.label}
                disabled={muted || !present}
                onPressIn={() => setPressedKey(action.key)}
                onPressOut={() => setPressedKey(null)}
                onPress={() => {
                  if (muted) return;
                  haptics.light();
                  contents.current.get(key)?.onPress();
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
              </Animated.View>
            );
          })}
          </View>
        </Animated.View>
      </View>
    </View>
  );
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
