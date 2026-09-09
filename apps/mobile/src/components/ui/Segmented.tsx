/**
 * Animated segmented control. Each active cell highlights with a springing
 * coral pill. Warm, compact, line-driven.
 */
import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { radius, springs, spacing } from "../../theme/tokens";
import { resolveFont } from "../../theme/tokens";

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

function Cell<T extends string>({
  option,
  active,
  onPress,
}: {
  option: { value: T; label: string };
  active: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const a = useSharedValue(active ? 1 : 0);

  React.useEffect(() => {
    a.value = withSpring(active ? 1 : 0, springs.snappy);
  }, [active, a]);

  const highlight = useAnimatedStyle(() => ({
    opacity: a.value,
    transform: [{ scale: 0.94 + a.value * 0.06 }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(a.value, [0, 1], [palette.textTertiary, palette.accent]),
  }));

  return (
    <Pressable style={styles.option} onPress={onPress}>
      <Animated.View
        pointerEvents="none"
        style={[styles.pill, { backgroundColor: palette.accentSoft, borderRadius: radius.xs }, highlight]}
      />
      <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {option.label}
      </Animated.Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const { palette } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: palette.surfaceSecondary, borderRadius: radius.sm }]}>
      {options.map((o) => (
        <Cell
          key={o.value}
          option={o}
          active={o.value === value}
          onPress={() => {
            if (o.value === value) return;
            haptics.selection();
            onChange(o.value);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", padding: spacing[4] },
  option: { flex: 1, paddingVertical: spacing[8], alignItems: "center", justifyContent: "center" },
  pill: { position: "absolute", top: spacing[4], bottom: spacing[4], left: spacing[4], right: spacing[4] },
  label: { fontFamily: resolveFont("display", "600"), fontSize: 12 },
});
