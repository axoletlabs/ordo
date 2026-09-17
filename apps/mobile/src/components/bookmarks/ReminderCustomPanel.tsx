import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { unixSeconds } from "@ordo/shared";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { Segmented } from "../ui/Segmented";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { layout, radius, spacing } from "../../theme/tokens";
import {
  QUARTER_HOUR_MINUTES,
  applyLocalDate,
  applyLocalTime,
  defaultCustomReminderAt,
  formatMonthTitle,
  formatReminderFull,
  hour12To24,
  localTimeParts,
  reminderMonthGrid,
  shiftCalendarMonth,
  weekdayNarrowLabels,
  type DayPeriod,
} from "../../lib/bookmark-reminders";

const HOURS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const PERIODS = [
  { value: "am" as const, label: "AM" },
  { value: "pm" as const, label: "PM" },
];

function seedUnix(initialUnix: number | null): number {
  return initialUnix != null && initialUnix > unixSeconds() ? initialUnix : defaultCustomReminderAt();
}

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
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(() => seedUnix(initialUnix));
  const [view, setView] = useState(() => {
    const parts = localTimeParts(seedUnix(initialUnix));
    return { year: parts.year, month: parts.month };
  });

  useEffect(() => {
    if (!visible) return;
    const next = seedUnix(initialUnix);
    const parts = localTimeParts(next);
    setAt(next);
    setView({ year: parts.year, month: parts.month });
  }, [initialUnix, visible]);

  const now = useMemo(() => new Date(), [visible]);
  const parts = localTimeParts(at);
  const future = at > unixSeconds();
  const cells = useMemo(
    () => reminderMonthGrid(view.year, view.month, at, now),
    [view.year, view.month, at, now],
  );
  const weekdays = useMemo(() => weekdayNarrowLabels(), []);
  const nowMonth = now.getFullYear() === view.year && now.getMonth() === view.month;
  const scrollMax =
    height - insets.top - insets.bottom - spacing[48] - layout.overlayPadding * 2 - 72;

  const setTime = (hour12: number, period: DayPeriod, minute: number) => {
    setAt((current) => applyLocalTime(current, hour12To24(hour12, period), minute));
  };

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} maxWidth={layout.overlayConfirmWidth}>
      <ThemedScrollView
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: Math.max(240, scrollMax) }}
      >
        <PanelHeader
          icon="alarm-outline"
          iconColor={palette.accent}
          title="Custom"
          subtitle={formatReminderFull(at)}
        />
        <View style={styles.monthNav}>
          <MonthChevrons
            label="Previous month"
            icon="chevron-back"
            disabled={nowMonth}
            onPress={() => setView((current) => shiftCalendarMonth(current.year, current.month, -1))}
          />
          <Text variant="bodyStrong" align="center" numberOfLines={1} style={styles.monthTitle}>
            {formatMonthTitle(view.year, view.month)}
          </Text>
          <MonthChevrons
            label="Next month"
            icon="chevron-forward"
            onPress={() => setView((current) => shiftCalendarMonth(current.year, current.month, 1))}
          />
        </View>
        <View style={styles.weekdays}>
          {weekdays.map((label, index) => (
            <Text key={`${label}-${index}`} variant="caption" color="tertiary" align="center" style={styles.weekday}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.days}>
          {cells.map((cell) => {
            if (!cell.inMonth || cell.day == null) {
              return <View key={cell.key} style={styles.dayCell} />;
            }
            const disabled = cell.isPast;
            return (
              <Pressable
                key={cell.key}
                accessibilityRole="button"
                accessibilityLabel={`${cell.day}${cell.isToday ? ", today" : ""}${cell.selected ? ", selected" : ""}`}
                accessibilityState={{ disabled, selected: cell.selected }}
                disabled={disabled}
                onPress={() => {
                  haptics.selection();
                  setAt((current) => applyLocalDate(current, cell.year, cell.month, cell.day!));
                }}
                style={({ pressed }) => [styles.dayCell, { opacity: pressed ? 0.7 : 1 }]}
              >
                <View
                  style={[
                    styles.dayHit,
                    cell.selected ? { backgroundColor: palette.accent } : null,
                  ]}
                >
                  <Text
                    variant="caption"
                    color={cell.selected ? "onAccent" : cell.isPast ? "faint" : cell.isToday ? "accent" : "primary"}
                    align="center"
                  >
                    {cell.day}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.rule, { backgroundColor: palette.border }]} />
        <Segmented
          options={PERIODS}
          value={parts.period}
          onChange={(period) => setTime(parts.hour12, period, parts.minute)}
        />
        <View style={styles.hours}>
          {HOURS_12.map((hour) => {
            const selected = hour === parts.hour12;
            return (
              <Pressable
                key={hour}
                accessibilityRole="button"
                accessibilityLabel={`${hour} o'clock`}
                accessibilityState={{ selected }}
                onPress={() => {
                  haptics.selection();
                  setTime(hour, parts.period, parts.minute);
                }}
                style={({ pressed }) => [
                  styles.hourCell,
                  {
                    backgroundColor: selected ? palette.accentSoft : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text variant="caption" color={selected ? "accent" : "secondary"} align="center">
                  {hour}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.minutes}>
          {QUARTER_HOUR_MINUTES.map((minute) => {
            const selected = minute === parts.minute;
            const label = `:${String(minute).padStart(2, "0")}`;
            return (
              <Pressable
                key={minute}
                accessibilityRole="button"
                accessibilityLabel={`${minute} minutes`}
                accessibilityState={{ selected }}
                onPress={() => {
                  haptics.selection();
                  setTime(parts.hour12, parts.period, minute);
                }}
                style={({ pressed }) => [
                  styles.minuteCell,
                  {
                    backgroundColor: selected ? palette.accentSoft : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text variant="monoSmall" color={selected ? "accent" : "secondary"} align="center">
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {!future ? (
          <Text variant="footnote" color="danger" align="center" style={styles.hint}>
            Pick a time in the future.
          </Text>
        ) : null}
      </ThemedScrollView>
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

function MonthChevrons({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: "chevron-back" | "chevron-forward";
  disabled?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        if (disabled) return;
        haptics.selection();
        onPress();
      }}
      style={[styles.monthHit, { opacity: disabled ? 0.28 : 1 }]}
    >
      <Ionicons name={icon} size={18} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    marginBottom: spacing[8],
  },
  monthTitle: { flex: 1, minWidth: 0 },
  monthHit: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  weekdays: { flexDirection: "row" },
  weekday: { flex: 1, paddingVertical: spacing[4] },
  days: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: "14.2857%",
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dayHit: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing[12],
  },
  hours: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing[8],
  },
  hourCell: {
    width: "25%",
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  minutes: {
    flexDirection: "row",
    marginTop: spacing[4],
    gap: spacing[4],
  },
  minuteCell: {
    flex: 1,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { marginTop: spacing[12] },
});
