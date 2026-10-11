import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { Button } from "../ui/Button";
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
  applyLocalDate,
  applyLocalTime,
  defaultCustomReminderAt,
  formatMonthTitle,
  formatReminderFull,
  localTimeParts,
  reminderMonthGrid,
  shiftCalendarMonth,
  weekdayNarrowLabels,
} from "../../lib/bookmark-reminders";
import { formatCalendarInput, parseCalendarInput } from "../../lib/calendar-input";
import { parseTimeInput } from "../../lib/time-input";
import { useHourCycle } from "../../hooks/use-hour-cycle";

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
  const [dateMode, setDateMode] = useState<"calendar" | "input">("calendar");
  const [yearInput, setYearInput] = useState(() => String(localTimeParts(seedUnix(initialUnix)).year));
  const hour12 = useHourCycle();
  const hour12Ref = useRef(hour12);
  const previousHour12 = useRef(hour12);
  hour12Ref.current = hour12;
  const [hourInput, setHourInput] = useState(() => String(hour12 ? localTimeParts(seedUnix(initialUnix)).hour12 : new Date(seedUnix(initialUnix) * 1000).getHours()));
  const [minuteInput, setMinuteInput] = useState(() => String(localTimeParts(seedUnix(initialUnix)).minute).padStart(2, "0"));
  const calendarRef = useRef<View>(null);
  const focusDate = useRef<string | null>(null);
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
    setYearInput(String(parts.year));
    setHourInput(String(hour12Ref.current ? parts.hour12 : new Date(next * 1000).getHours()));
    setMinuteInput(String(parts.minute).padStart(2, "0"));
    setView({ year: parts.year, month: parts.month });
  }, [initialUnix, visible]);
  useEffect(() => {
    // Changing the OS clock format must not discard the user's chosen date/time.
    if (previousHour12.current === hour12) return;
    previousHour12.current = hour12;
    setHourInput(String(hour12 ? localTimeParts(at).hour12 : new Date(at * 1000).getHours()));
  }, [at, hour12]);

  const now = useMemo(() => new Date(), [visible]);
  const parts = localTimeParts(at);
  const future = at > unixSeconds();
  // Seven independent 48dp dates need 336dp inside the dialog. Use Material's
  // text-entry alternative rather than overlapping hitSlop in compact windows.
  const calendarVisible = width >= 416 && dateMode === "calendar";
  const inputDate = parseCalendarInput(dateInput);
  const dateValid = calendarVisible || inputDate !== null;
  const cells = useMemo(
    () => reminderMonthGrid(view.year, view.month, at, now),
    [view.year, view.month, at, now],
  );
  const weekdays = useMemo(() => weekdayNarrowLabels(), []);
  const nowMonth = now.getFullYear() === view.year && now.getMonth() === view.month;
  useEffect(() => setYearInput(String(view.year)), [view.year]);

  const inputTime = parseTimeInput(hourInput, minuteInput, hour12, parts.period);
  const setTime = (hour: string, minute: string, period = parts.period) => {
    const parsed = parseTimeInput(hour, minute, hour12, period);
    if (parsed) setAt((current) => applyLocalTime(current, parsed.hour, parsed.minute));
  };
  useEffect(() => {
    if (!focusDate.current || Platform.OS !== "web") return;
    const date = focusDate.current;
    const frame = requestAnimationFrame(() => {
      (calendarRef.current as unknown as HTMLElement)?.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`)?.focus();
      focusDate.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [at, view.year, view.month]);
  const calendarKeys = Platform.OS === "web" ? { onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (busy) return;
    const raw = (event.target as HTMLElement).dataset.calendarDate;
    const parsed = raw && parseCalendarInput(raw);
    if (!parsed) return;
    const date = new Date(parsed.year, parsed.month, parsed.day);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7
      : event.key === "Home" ? -date.getDay() : event.key === "End" ? 6 - date.getDay() : null;
    if (step == null && event.key !== "PageUp" && event.key !== "PageDown") return;
    event.preventDefault(); event.stopPropagation();
    if (step != null) date.setDate(date.getDate() + step);
    else { const day = date.getDate(); date.setDate(1); date.setMonth(date.getMonth() + (event.key === "PageUp" ? -1 : 1)); date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())); }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (date < today) return;
    const next = applyLocalDate(at, date.getFullYear(), date.getMonth(), date.getDate());
    focusDate.current = formatCalendarInput(next);
    setAt(next); setDateInput(formatCalendarInput(next)); setView({ year: date.getFullYear(), month: date.getMonth() });
  } } : {};

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} dismissible={!busy} maxWidth={384}>
      <PanelHeader
          icon="alarm-outline"
          iconColor={palette.accent}
          title="Custom reminder"
          subtitle={formatReminderFull(at)}
        />
      <View>
        {width >= 416 ? <Button label={calendarVisible ? "Enter date" : "Show calendar"} variant="ghost"
          disabled={busy}
          onPress={() => { if (!calendarVisible) setDateInput(formatCalendarInput(at)); setDateMode(calendarVisible ? "input" : "calendar"); }} /> : null}
        {calendarVisible ? <><View style={styles.monthNav}>
          <MonthChevrons
            label="Previous month"
            icon="chevron-back"
            disabled={nowMonth || busy}
            onPress={() => setView((current) => shiftCalendarMonth(current.year, current.month, -1))}
          />
          <Text variant="bodyStrong" align="center" numberOfLines={1} style={styles.monthTitle}>
            {formatMonthTitle(view.year, view.month)}
          </Text>
          <MonthChevrons
            label="Next month"
            disabled={busy}
            icon="chevron-forward"
            onPress={() => setView((current) => shiftCalendarMonth(current.year, current.month, 1))}
          />
        </View>
        <Input label="Year" accessibilityLabel="Calendar year" value={yearInput} maxLength={4} keyboardType="number-pad" inputMode="numeric"
          disabled={busy}
          reserveSupportingSpace={false} error={/^\d{4}$/.test(yearInput) && Number(yearInput) >= now.getFullYear() ? undefined : `Enter a year from ${now.getFullYear()}.`}
          onChangeText={(text) => { setYearInput(text); if (/^\d{4}$/.test(text) && Number(text) >= now.getFullYear()) setView((current) => ({ ...current, year: Number(text) })); }} />
        <View style={styles.weekdays}>
          {weekdays.map((label, index) => (
            <View key={`${label}-${index}`} style={styles.weekday}>
            <Text variant="caption" color="tertiary" align="center" style={styles.cellLabel}>
              {label}
            </Text>
          </View>
          ))}
        </View>
        <View ref={calendarRef} {...calendarKeys} accessibilityRole="radiogroup" accessibilityLabel="Reminder date" style={styles.days}>
          {cells.map((cell) => {
            if (!cell.inMonth || cell.day == null) {
              return <View key={cell.key} style={styles.dayCell} />;
            }
            const disabled = cell.isPast || busy;
            return (
              <PressableScale
                key={cell.key}
                accessibilityRole="radio"
                accessibilityLabel={new Date(cell.year, cell.month, cell.day).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                accessibilityState={{ disabled, checked: cell.selected }}
                {...(Platform.OS === "web" ? { dataSet: { calendarDate: formatCalendarInput(new Date(cell.year, cell.month, cell.day).getTime() / 1000) }, tabIndex: cell.selected || !cells.some((candidate) => candidate.selected) && cell === cells.find((candidate) => candidate.inMonth && !candidate.isPast) ? 0 : -1 } : {})}
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
                    cell.isToday && !cell.selected ? { borderWidth: 1, borderColor: palette.primary } : null,
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
           accessibilityLabel="Reminder date" autoCapitalize="none" autoCorrect={false} required disabled={busy}
          error={inputDate ? undefined : "Enter a valid date as YYYY-MM-DD."}
          onChangeText={(text) => { setDateInput(text); const date = parseCalendarInput(text);
            if (date) { setAt((current) => applyLocalDate(current, date.year, date.month, date.day)); setView({ year: date.year, month: date.month }); } }} />}
        <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Input label="Hour" accessibilityLabel="Reminder hour" value={hourInput} keyboardType="number-pad" inputMode="numeric" maxLength={2}
            containerStyle={{ flex: 1 }} disabled={busy} required helper={hour12 ? "1–12" : "0–23"}
            error={parseTimeInput(hourInput, "00", hour12, parts.period) ? undefined : hour12 ? "Enter 1–12." : "Enter 0–23."}
            onChangeText={(hour) => { setHourInput(hour); setTime(hour, minuteInput); }} />
          <Input label="Minute" accessibilityLabel="Reminder minute" value={minuteInput} keyboardType="number-pad" inputMode="numeric" maxLength={2}
            containerStyle={{ flex: 1 }} disabled={busy} required helper="0–59"
            error={/^\d{1,2}$/.test(minuteInput) && Number(minuteInput) <= 59 ? undefined : "Enter 0–59."}
            onChangeText={(minute) => { setMinuteInput(minute); setTime(hourInput, minute); }} />
        </View>
        {hour12 ? <Segmented
          disabled={busy}
          options={PERIODS}
          accessibilityLabel="Day period"
          value={parts.period}
          onChange={(period) => setTime(hourInput, minuteInput, period)}
        /> : null}
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
        confirmDisabled={!future || !dateValid || !inputTime || busy}
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
  hint: { marginTop: spacing[12] },
});
