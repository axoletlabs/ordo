import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { PressableScale } from "../ui/PressableScale";
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
  MINUTE_STEPS,
  defaultCustomReminderAt,
  formatMonthTitle,
  formatReminderFull,
  hour12To24,
  localTimeParts,
  reminderMonthGrid,
  shiftCalendarMonth,
  weekdayNarrowLabels,
} from "../../lib/bookmark-reminders";
import { formatCalendarInput, parseCalendarInput } from "../../lib/calendar-input";
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
  const [at, setAt] = useState(() => seedUnix(initialUnix));
  const hour12 = useHourCycle();
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

  const pickTime = (hour: number, minute: number, period = parts.period) => {
    setAt((current) => applyLocalTime(current, hour12 ? hour12To24(hour, period) : hour, minute));
  };
  useEffect(() => {
    if (!visible) { focusDate.current = null; return; }
    if (!focusDate.current || Platform.OS !== "web") return;
    const date = focusDate.current;
    const frame = requestAnimationFrame(() => {
      (calendarRef.current as unknown as HTMLElement)?.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`)?.focus();
      focusDate.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [at, view.year, view.month, visible]);
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
    setAt(next); setView({ year: date.getFullYear(), month: date.getMonth() });
  } } : {};

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} dismissible={!busy} maxWidth={384} style={styles.panel}>
      <PanelHeader
          title="Custom reminder"
          subtitle={formatReminderFull(at)}
          style={styles.header}
        />
      <View>
        <ScrollView horizontal contentContainerStyle={styles.calendarScroll}>
        <View style={styles.calendar}><View style={styles.monthNav}>
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
        </View></View></ScrollView>
        <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
        {hour12 ? <Segmented
          disabled={busy}
          options={PERIODS}
          accessibilityLabel="Day period"
          value={parts.period}
          onChange={(period) => pickTime(parts.hour12, parts.minute, period)}
        /> : null}
        <TimeButtons label="Reminder hour" values={Array.from({ length: hour12 ? 12 : 24 }, (_, index) => hour12 ? index + 1 : index)}
            value={hour12 ? parts.hour12 : new Date(at * 1000).getHours()} disabled={busy}
            format={(hour) => hour12 ? String(hour) : String(hour).padStart(2, "0")}
            describe={(hour) => `${hour} o'clock`} onChange={(hour) => pickTime(hour, parts.minute)} />
          <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
          <TimeButtons label="Reminder minute" values={MINUTE_STEPS} value={parts.minute} disabled={busy}
            format={(minute) => `:${String(minute).padStart(2, "0")}`} describe={(minute) => `${minute} minutes`}
            onChange={(minute) => pickTime(hour12 ? parts.hour12 : new Date(at * 1000).getHours(), minute)} />
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
        confirmDisabled={!future || busy}
      />
    </FloatingPanel>
  );
}

function TimeButtons({ label, values, value, disabled, format, describe, onChange }: {
  label: string;
  values: readonly number[];
  value: number;
  disabled?: boolean;
  format: (value: number) => string;
  describe: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const { palette, expressive } = useTheme();
  const keyboardProps = Platform.OS === "web" ? {
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
      const index = radios.indexOf(event.target as HTMLElement);
      if (index < 0) return;
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 6 : event.key === "ArrowUp" ? -6 : null;
      if (step == null && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      event.stopPropagation();
      const next = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (index + step! + values.length) % values.length;
      haptics.selection();
      onChange(values[next]!);
      radios[next]?.focus();
    },
  } : {};
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} {...keyboardProps} style={styles.timeButtons}>
    {values.map((option, index) => {
      const selected = option === value;
      return <PressableScale key={option} accessibilityRole="radio" accessibilityLabel={describe(option)} disabled={disabled}
        accessibilityState={{ checked: selected, disabled: !!disabled }}
        {...(Platform.OS === "web" ? { tabIndex: selected || !values.includes(value) && index === 0 ? 0 : -1 } : {})}
        stateLayerColor={selected ? palette.onSecondaryContainer : palette.onSurface}
        style={[styles.padCell, { backgroundColor: selected ? palette.secondaryContainer : "transparent", opacity: disabled ? 0.38 : 1 }]}
        shape={{ rest: expressive && selected ? 24 : radius.sm, pressed: radius.sm }}
        onPress={() => { haptics.selection(); onChange(option); }}>
        <Text variant="labelLarge" align="center" style={{ color: selected ? palette.onSecondaryContainer : palette.onSurface }}>{format(option)}</Text>
      </PressableScale>;
    })}
  </View>;
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
  // Keep seven non-overlapping 48dp dates on a 390dp phone. Narrower windows
  // scroll the calendar instead of shrinking the tap targets.
  panel: { paddingHorizontal: spacing[8] },
  header: { marginHorizontal: spacing[16] },
  calendarScroll: { flexGrow: 1, justifyContent: "center" },
  calendar: { width: 336 },
  timeButtons: { flexDirection: "row", flexWrap: "wrap" },
  padCell: { width: "16.666666%", minWidth: 48, height: 48, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
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
    marginVertical: spacing[8],
  },
  hint: { marginTop: spacing[12] },
});
