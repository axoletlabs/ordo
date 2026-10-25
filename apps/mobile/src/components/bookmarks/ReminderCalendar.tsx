import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { PressableScale } from "../ui/PressableScale";
import { MaterialIcon } from "../ui/MaterialIcon";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { spacing } from "../../theme/tokens";
import { applyLocalDate, formatMonthTitle, localTimeParts, reminderDateLabels, reminderMonthGrid, shiftCalendarMonth, weekdayNarrowLabels } from "../../lib/bookmark-reminders";
import { formatCalendarInput, parseCalendarInput } from "../../lib/calendar-input";

/** The calendar is a separate editing step, not part of every time edit/open. */
export function ReminderCalendar({ at, disabled = false, active, onChange }: {
  at: number; disabled?: boolean; active: React.RefObject<boolean>; onChange: (at: number) => void;
}) {
  const { palette } = useTheme();
  const [view, setView] = useState(() => { const parts = localTimeParts(at); return { year: parts.year, month: parts.month }; });
  const calendarRef = useRef<View>(null);
  const focusDate = useRef<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const cells = useMemo(() => reminderMonthGrid(view.year, view.month, at, now), [view.year, view.month, at, now]);
  const dateLabels = useMemo(() => reminderDateLabels(view.year, view.month), [view.year, view.month]);
  const weekdays = useMemo(() => weekdayNarrowLabels(), []);
  const monthTitle = useMemo(() => formatMonthTitle(view.year, view.month), [view.year, view.month]);
  const nowMonth = now.getFullYear() === view.year && now.getMonth() === view.month;
  const tabbable = cells.find((cell) => cell.selected) ?? cells.find((cell) => cell.inMonth && !cell.isPast);
  useEffect(() => {
    if (!focusDate.current || Platform.OS !== "web") return;
    const date = focusDate.current;
    const frame = requestAnimationFrame(() => {
      focusDate.current = null;
      // FloatingPanel freezes its exiting children. Read the live session ref,
      // not a frozen visible prop, so quick Back/save cannot steal focus later.
      if (!active.current) return;
      (calendarRef.current as unknown as HTMLElement)?.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [at, view.year, view.month, active]);
  const keyboard = Platform.OS === "web" ? { onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
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
    if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return;
    const next = applyLocalDate(at, date.getFullYear(), date.getMonth(), date.getDate());
    focusDate.current = formatCalendarInput(next);
    onChange(next); setView({ year: date.getFullYear(), month: date.getMonth() });
  } } : {};
  return <ScrollView horizontal contentContainerStyle={styles.scroll}>
    <View style={styles.calendar}>
      <View style={styles.monthNav}>
        {([-1, 1] as const).map((direction) => <React.Fragment key={direction}>
          {direction === 1 ? <Text variant="bodyStrong" align="center" numberOfLines={1} style={styles.monthTitle}>{monthTitle}</Text> : null}
          <PressableScale accessibilityRole="button" accessibilityLabel={direction === -1 ? "Previous month" : "Next month"}
            disabled={disabled || direction === -1 && nowMonth} accessibilityState={{ disabled: disabled || direction === -1 && nowMonth }}
            stateLayerColor={palette.onSurface} style={[styles.monthHit, { opacity: disabled || direction === -1 && nowMonth ? 0.38 : 1 }]}
            onPress={() => { haptics.selection(); setView((current) => shiftCalendarMonth(current.year, current.month, direction)); }}>
            <MaterialIcon name={direction === -1 ? "chevron-back" : "chevron-forward"} size={24} color={palette.onSurface} />
          </PressableScale>
        </React.Fragment>)}
      </View>
      <View style={styles.weekdays}>{weekdays.map((label, index) => <View key={index} style={styles.weekday}>
        <Text variant="caption" color="tertiary" align="center" style={styles.cellLabel}>{label}</Text>
      </View>)}</View>
      <View ref={calendarRef} {...keyboard} accessibilityRole="radiogroup" accessibilityLabel="Reminder date" style={styles.days}>
        {cells.map((cell) => !cell.inMonth || cell.day == null ? <View key={cell.key} style={styles.dayCell} /> :
          <PressableScale key={cell.key} accessibilityRole="radio" accessibilityLabel={dateLabels[cell.day - 1]}
            accessibilityState={{ disabled: cell.isPast || disabled, checked: cell.selected }} disabled={cell.isPast || disabled}
            {...(Platform.OS === "web" ? { dataSet: { calendarDate: formatCalendarInput(new Date(cell.year, cell.month, cell.day).getTime() / 1000) }, tabIndex: cell === tabbable ? 0 : -1 } : {})}
            onPress={() => { haptics.selection(); onChange(applyLocalDate(at, cell.year, cell.month, cell.day!)); }}
            stateLayerColor={cell.selected ? palette.onPrimary : palette.primary} style={styles.dayCell}>
            <View style={styles.dayHit}>
              {/* Explicit geometry retains rounded selection on Android, even
                  when an ordinary layout-only date becomes selected. */}
              {cell.selected || cell.isToday ? <Svg width={40} height={40} style={StyleSheet.absoluteFill} pointerEvents="none" accessible={Platform.OS === "web" ? undefined : false} aria-hidden>
                <Circle cx={20} cy={20} r={cell.isToday && !cell.selected ? 19.5 : 20} fill={cell.selected ? palette.primary : "none"}
                  stroke={cell.isToday && !cell.selected ? palette.primary : "none"} strokeWidth={1} />
              </Svg> : null}
              <Text variant="bodyLarge" color={cell.selected ? "onAccent" : cell.isPast ? "faint" : cell.isToday ? "accent" : "primary"}
                align="center" style={styles.cellLabel}>{cell.day}</Text>
            </View>
          </PressableScale>)}
      </View>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center" },
  calendar: { width: 336 },
  monthNav: { flexDirection: "row", alignItems: "center", gap: spacing[8], marginBottom: spacing[8] },
  monthTitle: { flex: 1, minWidth: 0 },
  monthHit: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  weekdays: { flexDirection: "row" },
  weekday: { width: 48, alignItems: "center", paddingVertical: spacing[4] },
  cellLabel: { includeFontPadding: false },
  days: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  dayHit: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
