import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { unixSeconds } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import {
  defaultCustomReminderAt,
  formatCustomDate,
  formatLocalTime,
  formatReminderFull,
  shiftLocalDays,
  shiftLocalMinutes,
} from "../../lib/bookmark-reminders";

export function ReminderCustomPanel({
  visible,
  initialUnix,
  onDismiss,
  onConfirm,
  busy,
}: {
  visible: boolean;
  initialUnix: number | null;
  onDismiss: () => void;
  onConfirm: (unix: number) => void;
  busy?: boolean;
}) {
  const { palette } = useTheme();
  const [at, setAt] = useState(() =>
    initialUnix != null && initialUnix > unixSeconds() ? initialUnix : defaultCustomReminderAt(),
  );

  useEffect(() => {
    if (!visible) return;
    const next =
      initialUnix != null && initialUnix > unixSeconds() ? initialUnix : defaultCustomReminderAt();
    setAt(next);
  }, [initialUnix, visible]);

  const future = at > unixSeconds();
  const subtitle = useMemo(() => formatReminderFull(at), [at]);

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} fitContent style={{ minWidth: 300 }}>
      <PanelHeader icon="alarm-outline" iconColor={palette.accent} title="Custom" subtitle={subtitle} />
      <View style={styles.steppers}>
        <Stepper
          label="Date"
          value={formatCustomDate(at)}
          onDecrement={() => setAt((current) => shiftLocalDays(current, -1))}
          onIncrement={() => setAt((current) => shiftLocalDays(current, 1))}
          decrementLabel="Previous day"
          incrementLabel="Next day"
        />
        <Stepper
          label="Time"
          value={formatLocalTime(at)}
          onDecrement={() => setAt((current) => shiftLocalMinutes(current, -5))}
          onIncrement={() => setAt((current) => shiftLocalMinutes(current, 5))}
          decrementLabel="Five minutes earlier"
          incrementLabel="Five minutes later"
        />
      </View>
      {!future ? (
        <Text variant="footnote" color="danger" align="center" style={styles.hint}>
          Pick a time in the future.
        </Text>
      ) : null}
      <PanelActions
        confirmLabel="Remind"
        onConfirm={() => onConfirm(at)}
        onCancel={onDismiss}
        loading={busy}
        confirmDisabled={!future || busy}
      />
    </FloatingPanel>
  );
}

function Stepper({
  label,
  value,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
}: {
  label: string;
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
}) {
  const { palette } = useTheme();
  return (
    <View style={styles.stepper}>
      <Text variant="label" color="secondary" align="center">
        {label}
      </Text>
      <View style={styles.stepperRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={decrementLabel}
          onPress={onDecrement}
          style={[styles.stepperHit, { borderColor: palette.border }]}
        >
          <Ionicons name="chevron-back" size={18} color={palette.text} />
        </PressableScale>
        <Text variant="bodyStrong" align="center" numberOfLines={1} style={styles.stepperValue}>
          {value}
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={incrementLabel}
          onPress={onIncrement}
          style={[styles.stepperHit, { borderColor: palette.border }]}
        >
          <Ionicons name="chevron-forward" size={18} color={palette.text} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  steppers: { gap: spacing[16], marginTop: spacing[4] },
  stepper: { gap: spacing[8] },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
  },
  stepperHit: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: { flex: 1, minWidth: 0 },
  hint: { marginTop: spacing[12] },
});
