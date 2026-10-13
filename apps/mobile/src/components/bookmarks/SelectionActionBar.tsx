import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { AppIcon } from "../ui/PinIcon";
import { StretchablePill } from "../ui/StretchablePill";
import { Text } from "../ui/Text";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { selectionActionPositions } from "../../lib/selection-action-layout";
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

type ActionLayout = ReturnType<typeof selectionActionPositions>;
// Fade departures before handing their space to surviving actions. Never
// collapse a departing button's width: that clips its label and overlaps Delete.
const DEPARTURE_MS = 90;

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
  const [retained, setRetained] = useState<readonly SelectionAction[]>(actions);
  const available = Math.min(width, maxWidth) - column.left - column.right - 16;
  const keys = actions.map(action => action.key);
  const activePress = keys.includes(pressedKey ?? "") ? pressedKey : null;
  const target = selectionActionPositions(keys, available, activePress, !motion.reducedMotion);
  const latest = useRef(actions);
  latest.current = actions;
  const positions = useSharedValue<ActionLayout>(target);
  const geometryReady = useSharedValue(true);
  const departureOpacity = useSharedValue(1);
  const previousKeys = useRef(keys);
  const actionsKey = JSON.stringify(keys);
  const transition = useRef({ key: actionsKey, version: 0 });
  if (transition.current.key !== actionsKey) {
    transition.current = { key: actionsKey, version: transition.current.version + 1 };
  }

  // The bar fades/slides in when selection starts and back out when it ends,
  // instead of popping with the mount. It stays mounted through the exit.
  const visible = actions.length > 0;
  const [shown, setShown] = useState(visible);
  const containerOpacity = useSharedValue(0);
  const containerShift = useSharedValue(12);
  const finishExit = useCallback((version: number) => {
    if (version !== transition.current.version || latest.current.length) return;
    setShown(false);
    setRetained([]);
    setPressedKey(null);
  }, []);
  const removeDeparture = useCallback((key: string, version: number) => {
    // A stale fade callback must never delete an action that has returned, or
    // strip the contents out of the bar while the whole bar is exiting.
    if (version !== transition.current.version || !latest.current.length || latest.current.some(action => action.key === key)) return;
    setRetained(current => current.filter(action => action.key !== key));
  }, []);

  useLayoutEffect(() => {
    const current = latest.current;
    const currentKeys = current.map(action => action.key);
    const next = selectionActionPositions(currentKeys, available, activePress, !motion.reducedMotion);
    const departing = previousKeys.current.some(key => !currentKeys.includes(key));
    const reopening = current.length > 0 && previousKeys.current.length === 0;
    previousKeys.current = currentKeys;
    cancelAnimation(positions);
    cancelAnimation(departureOpacity);
    if (!current.length) return; // Keep the last geometry through the bar's exit.
    if (activePress == null) setPressedKey(null);
    setRetained(previous => [...current, ...previous.filter(action => !currentKeys.includes(action.key))]);
    // Seed new keys at their final size, but keep them invisible until the
    // surviving buttons have made room. One object spring keeps every edge
    // on the same trajectory, entirely on the native UI thread.
    const start = reopening ? next : { ...positions.value };
    for (const [key, value] of Object.entries(next)) if (start[key] == null) start[key] = value;
    positions.value = start;
    if (motion.reducedMotion || reopening) {
      positions.value = { ...start, ...next };
      geometryReady.value = true;
    } else {
      geometryReady.value = false;
      const animation = withSpring({ ...start, ...next }, { ...motion.spatial, overshootClamping: true }, finished => {
        if (finished) geometryReady.value = true;
      });
      if (departing) {
        // One UI-thread handoff: a wall-clock delay can finish before a slot's
        // fade starts on a busy frame. Growth begins only after all departures
        // are visibly transparent, without unmounting them during the stretch.
        departureOpacity.value = 1;
        departureOpacity.value = withTiming(0, { duration: DEPARTURE_MS, easing: Easing.out(Easing.quad) }, finished => {
          if (finished) positions.value = animation;
        });
      } else positions.value = animation;
    }
  }, [actionsKey, activePress, available, motion.spatial, motion.reducedMotion, positions, geometryReady, departureOpacity]);

  useLayoutEffect(() => {
    const version = transition.current.version;
    cancelAnimation(containerOpacity);
    cancelAnimation(containerShift);
    if (visible) {
      setShown(true);
      containerOpacity.value = motion.reducedMotion ? 1 : withSpring(1, materialMotion.effects.fast);
      containerShift.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
    } else if (shown) {
      if (motion.reducedMotion) {
        containerOpacity.value = 0;
        containerShift.value = 12;
        finishExit(version);
      } else {
        containerShift.value = withSpring(12, motion.spatial);
        containerOpacity.value = withSpring(0, materialMotion.effects.fast, finished => {
          if (finished) runOnJS(finishExit)(version);
        });
      }
    }
  }, [visible, shown, containerOpacity, containerShift, motion.spatial, motion.reducedMotion, finishExit]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ translateY: containerShift.value }],
  }));

  if (!shown) return null;

  // Current actions lead accessibility order; departing actions cannot receive
  // touches or keyboard focus, even during the first frame after selection changes.
  const ordered = [...actions, ...retained.filter(action => !keys.includes(action.key))];

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
          <View style={styles.actions}>
            {ordered.map(action => <ActionSlot key={action.key} action={action} present={keys.includes(action.key)} version={transition.current.version}
              positions={positions} canvasWidth={available} geometryReady={geometryReady} departureOpacity={departureOpacity} onExited={removeDeparture} onPressed={setPressedKey} />)}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function ActionSlot({ action, present, version, positions, canvasWidth, geometryReady, departureOpacity, onExited, onPressed }: {
  action: SelectionAction;
  present: boolean;
  version: number;
  positions: SharedValue<ActionLayout>;
  canvasWidth: number;
  geometryReady: SharedValue<boolean>;
  departureOpacity: SharedValue<number>;
  onExited: (key: string, version: number) => void;
  onPressed: (key: string | null) => void;
}) {
  const { palette, expressive } = useTheme();
  const motion = useMaterialMotion();
  const opacity = useSharedValue(0);
  const entered = useSharedValue(false);
  const slotRef = useRef<MeasureNode | null>(null);
  const [readyToPress, setReadyToPress] = useState(false);
  const status = useRef({ present, version });
  status.current = { present, version };
  const enableAction = useCallback((completedVersion: number) => {
    if (status.current.present && completedVersion === status.current.version) setReadyToPress(true);
  }, []);
  useLayoutEffect(() => {
    if (!present) setReadyToPress(false);
  }, [present]);
  const key = action.key;
  useAnimatedReaction(() => (present ? (geometryReady.value ? 1 : 0) : -1) + (motion.reducedMotion ? 4 : 0), state => {
    if (!present) {
      entered.value = false;
      if (motion.reducedMotion) {
        opacity.value = 0;
      } else {
        opacity.value = withTiming(0, { duration: DEPARTURE_MS, easing: Easing.out(Easing.quad) });
      }
    } else if (state === 1 || state === 5) {
      entered.value = true;
      opacity.value = motion.reducedMotion ? 1 : withSpring(1, materialMotion.effects.fast);
      runOnJS(enableAction)(version);
    } else if (!entered.value) {
      // Returning mid-fade cancels the old removal callback, but still waits
      // for the expanding Delete button to shrink out of this slot's space.
      opacity.value = motion.reducedMotion ? 0 : withTiming(0, { duration: DEPARTURE_MS });
    }
  }, [present, key, version, motion.reducedMotion, onExited, enableAction]);
  // Unmount hidden departures only *after* the stretch settles. Removing three
  // React/native subtrees at the exact frame Delete starts growing creates a
  // hitch even when the animation itself runs on the UI thread.
  useAnimatedReaction(() => !present && geometryReady.value && opacity.value === 0, remove => {
    if (remove) runOnJS(onExited)(key, version);
  }, [present, key, version, onExited]);
  const pillWidth = useDerivedValue(() => Math.max(48, positions.value[`${key}:width`] ?? 48));
  const slotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(positions.value[`${key}:right`] ?? 0) }],
    opacity: present ? opacity.value : Math.min(opacity.value, departureOpacity.value),
  }));
  const color = action.danger ? palette.onErrorContainer : palette.onSecondaryContainer;
  const interactive = present && readyToPress;
  return <Animated.View ref={slotRef as React.Ref<Animated.View>} pointerEvents={interactive ? "box-none" : "none"} aria-hidden={!interactive}
    accessibilityElementsHidden={!interactive} importantForAccessibility={interactive ? "auto" : "no-hide-descendants"}
    style={[styles.slot, { width: canvasWidth }, slotStyle]}>
    <StretchablePill width={pillWidth} canvasWidth={canvasWidth} accessibilityRole="button" accessibilityLabel={action.label}
      accessibilityState={{ disabled: !!action.disabled || !interactive }} disabled={action.disabled || !interactive}
      onPressIn={() => onPressed(key)} onPressOut={() => onPressed(null)} onBlur={() => onPressed(null)}
      onPress={() => {
        if (!interactive || action.disabled) return;
        haptics.light();
        // The layout canvas is deliberately fixed-size; menus anchor to the
        // painted/hit-tested pill, not that wider offscreen canvas.
        action.onPress({ measureInWindow: callback => slotRef.current?.measureInWindow?.((x, y, _width, height) => {
          const width = Math.min(canvasWidth, pillWidth.value);
          callback(x + canvasWidth - width, y, width, height);
        }) });
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
