import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { PressableScale } from "../ui/PressableScale";
import { Input } from "../ui/Input";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { unixSeconds } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { Segmented } from "../ui/Segmented";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { radius, spacing } from "../../theme/tokens";
import {
  MINUTE_STEPS,
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
import { formatCalendarInput, parseCalendarInput } from "../../lib/calendar-input";

const HOURS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const PERIODS = [
  { value: "am" as const, label: "AM" },
  { value: "pm" as const, label: "PM" },
];

function seedUnix(initialUnix: number | null): number {
  return initialUnix != null && initialUnix > unixSeconds() ? initialUnix : defaultCustomReminderAt();
}

export function ReminderCustomPanel(props: Parameters<typeof ReminderCustomPanelContent>[0]) {
  const [activated, setActivated] = useState(props.visible);
  if (props.visible && !activated) setActivated(true);
  return activated ? <ReminderCustomPanelContent {...props} /> : null;
}

function ReminderCustomPanelContent({
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
  const { width } = useWindowDimensions();
  const [at, setAt] = useState(() => seedUnix(initialUnix));
  const [dateInput, setDateInput] = useState(() => formatCalendarInput(seedUnix(initialUnix)));
  const [view, setView] = useState(() => {
    const parts = localTimeParts(seedUnix(initialUnix));
    return { year: parts.year, month: parts.month };
  });

  useEffect(() => {
    if (!visible) return;
    const next = seedUnix(initialUnix);
    const parts = localTimeParts(next);
    setAt(next);
    setDateInput(formatCalendarInput(next));
    setView({ year: parts.year, month: parts.month });
  }, [initialUnix, visible]);

  const now = useMemo(() => new Date(), [visible]);
  const parts = localTimeParts(at);
  const future = at > unixSeconds();
  // Seven independent 48dp dates need 336dp inside the dialog. Use Material's
  // text-entry alternative rather than overlapping hitSlop in compact windows.
  const calendarVisible = width >= 416;
  const inputDate = parseCalendarInput(dateInput);
  const dateValid = calendarVisible || inputDate !== null;
  const cells = useMemo(
    () => reminderMonthGrid(view.year, view.month, at, now),
    [view.year, view.month, at, now],
  );
  const weekdays = useMemo(() => weekdayNarrowLabels(), []);
  const nowMonth = now.getFullYear() === view.year && now.getMonth() === view.month;

  const setTime = (hour12: number, period: DayPeriod, minute: number) => {
    setAt((current) => applyLocalTime(current, hour12To24(hour12, period), minute));
  };

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} dismissible={!busy} maxWidth={384}>
      <PanelHeader
          icon="alarm-outline"
          iconColor={palette.accent}
          title="Custom reminder"
          subtitle={formatReminderFull(at)}
        />
      <View>
        {calendarVisible ? <><View style={styles.monthNav}>
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
            <View key={`${label}-${index}`} style={styles.weekday}>
            <Text variant="caption" color="tertiary" align="center" style={styles.cellLabel}>
              {label}
            </Text>
          </View>
          ))}
        </View>
        <View style={styles.days}>
          {cells.map((cell) => {
            if (!cell.inMonth || cell.day == null) {
              return <View key={cell.key} style={styles.dayCell} />;
            }
            const disabled = cell.isPast;
            return (
              <PressableScale
                key={cell.key}
                accessibilityRole="button"
                accessibilityLabel={new Date(cell.year, cell.month, cell.day).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                accessibilityState={{ disabled, selected: cell.selected }}
                disabled={disabled}
                onPress={() => {
                  haptics.selection();
                  setAt((current) => applyLocalDate(current, cell.year, cell.month, cell.day!));
                  setDateInput(formatCalendarInput(applyLocalDate(at, cell.year, cell.month, cell.day!)));
                }}
                stateLayerColor={cell.selected ? palette.onPrimary : palette.primary}
                style={[styles.dayCell, { borderRadius: radius.full }]}
              >
                <View
                  style={[
                    styles.dayHit,
                    cell.selected ? { backgroundColor: palette.accent } : null,
                  ]}
                >
                  <Text
                    variant="bodyLarge"
                    color={cell.selected ? "onAccent" : cell.isPast ? "faint" : cell.isToday ? "accent" : "primary"}
                    align="center"
                    style={styles.cellLabel}
                  >
                    {cell.day}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </View></> : <Input label="Date" value={dateInput} placeholder="YYYY-MM-DD" helper="Year-month-day, for example 2026-10-12."
          accessibilityLabel="Reminder date" autoCapitalize="none" autoCorrect={false}
          error={inputDate ? undefined : "Enter a valid date as YYYY-MM-DD."}
          onChangeText={(text) => { setDateInput(text); const date = parseCalendarInput(text);
            if (date) { setAt((current) => applyLocalDate(current, date.year, date.month, date.day)); setView({ year: date.year, month: date.month }); } }} />}
        <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
        <Segmented
          options={PERIODS}
          accessibilityLabel="Day period"
          value={parts.period}
          onChange={(period) => setTime(parts.hour12, period, parts.minute)}
        />
        <View style={styles.hours}>
          {HOURS_12.map((hour) => {
            const selected = hour === parts.hour12;
            return (
              <PadCell
                key={hour}
                label={String(hour)}
                accessibilityLabel={`${hour} o'clock`}
                selected={selected}
                onPress={() => setTime(hour, parts.period, parts.minute)}
              />
            );
          })}
        </View>
        <View style={styles.minutes}>
          {MINUTE_STEPS.map((minute) => {
            const selected = minute === parts.minute;
            const label = `:${String(minute).padStart(2, "0")}`;
            return (
              <PadCell
                key={minute}
                label={label}
                accessibilityLabel={`${minute} minutes`}
                selected={selected}
                mono
                onPress={() => setTime(parts.hour12, parts.period, minute)}
              />
            );
          })}
        </View>
        {!future ? (
          <Text variant="footnote" color="danger" align="center" style={styles.hint}>
            Pick a time in the future.
          </Text>
        ) : null}
      </View>
      <PanelActions
        confirmLabel="Remind"
        onConfirm={() => onConfirm(at)}
        onCancel={onDismiss}
        loading={busy}
        confirmDisabled={!future || !dateValid || busy}
      />
    </FloatingPanel>
  );
}

function PadCell({
  label,
  accessibilityLabel,
  selected,
  mono,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  mono?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      stateLayerColor={selected ? palette.onSecondaryContainer : palette.onSurface}
      style={[
        styles.padCell,
        {
          backgroundColor: selected ? palette.secondaryContainer : "transparent",
        },
      ]}
    >
      <Text
        variant={mono ? "monoSmall" : "caption"}
        color="secondary"
        align="center"
        style={[styles.cellLabel, { color: selected ? palette.onSecondaryContainer : palette.onSurfaceVariant }]}
      >
        {label}
      </Text>
    </PressableScale>
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
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      stateLayerColor={palette.onSurface}
      onPress={() => {
        if (disabled) return;
        haptics.selection();
        onPress();
      }}
      style={[styles.monthHit, { borderRadius: radius.full, opacity: disabled ? 0.38 : 1 }]}
    >
      <Ionicons name={icon} size={24} color={palette.onSurface} />
    </PressableScale>
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
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  weekdays: { flexDirection: "row" },
  weekday: {
    width: 48,
    alignItems: "center",
    paddingVertical: spacing[4],
  },
  cellLabel: { includeFontPadding: false },
  days: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  dayHit: {
    width: 40,
    height: 40,
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
  minutes: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing[4],
  },
  padCell: {
    width: "25%",
    height: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { marginTop: spacing[12] },
});
