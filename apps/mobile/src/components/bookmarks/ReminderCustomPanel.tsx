import React, { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { unixSeconds } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { Segmented } from "../ui/Segmented";
import { ClockTimePicker } from "../ui/ClockTimePicker";
import { Text } from "../ui/Text";
import { spacing } from "../../theme/tokens";
import { applyLocalTime, defaultCustomReminderAt, localTimeParts } from "../../lib/bookmark-reminders";
import { useHourCycle } from "../../hooks/use-hour-cycle";
import { ReminderCalendar } from "./ReminderCalendar";

const SECTIONS = [{ value: "date", label: "Date" }, { value: "time", label: "Time" }] as const;
type Section = typeof SECTIONS[number]["value"];
function seedUnix(initialUnix: number | null): number {
  return initialUnix != null && initialUnix > unixSeconds() ? initialUnix : defaultCustomReminderAt();
}

export function ReminderCustomPanel(props: Parameters<typeof ReminderCustomPanelContent>[0]) {
  const [activated, setActivated] = useState(props.visible);
  if (props.visible && !activated) setActivated(true);
  return activated ? <ReminderCustomPanelContent {...props} /> : null;
}

function ReminderCustomPanelContent({ visible, initialUnix, onDismiss, onExited, onConfirm, busy }: {
  visible: boolean; initialUnix: number | null; onDismiss: () => void; onExited?: () => void; onConfirm: (unix: number) => void; busy?: boolean;
}) {
  const hour12 = useHourCycle();
  const active = useRef(visible && !busy);
  active.current = visible && !busy;
  const [draft, setDraft] = useState(() => ({ at: seedUnix(initialUnix), section: "time" as Section, visible, initialUnix }));
  // Reset before committing descendants, not in an opening effect that mounts
  // the old calendar/time controls and then renders them a second time.
  let current = draft;
  if (visible && (!draft.visible || draft.initialUnix !== initialUnix)) {
    current = { at: seedUnix(initialUnix), section: "time", visible, initialUnix };
    setDraft(current);
  } else if (!visible && draft.visible) setDraft({ ...draft, visible });
  const { at, section } = current;
  const formatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12,
  }), [visible, hour12]);
  const subtitle = useMemo(() => formatter.format(new Date(at * 1000)), [at, formatter]);
  const parts = localTimeParts(at);
  const future = at > unixSeconds();
  const changeDate = (next: number) => setDraft((state) => ({ ...state, at: next }));
  return <FloatingPanel visible={visible} onDismiss={onDismiss} onExited={onExited} dismissible={!busy} maxWidth={384} pageKey={section} style={styles.panel}>
    <PanelHeader title="Custom reminder" subtitle={subtitle} style={styles.rail} />
    <View style={styles.body}>
      <View style={styles.rail}><Segmented options={SECTIONS} accessibilityLabel="Reminder date or time" value={section} disabled={busy}
        onChange={(next) => setDraft((state) => ({ ...state, section: next }))} /></View>
      {section === "date" ? <ReminderCalendar at={at} disabled={busy} active={active} onChange={changeDate} /> :
        <View style={styles.rail}><ClockTimePicker hour={parts.hour} minute={parts.minute} hour12={hour12} disabled={busy}
          onChange={(hour, minute) => setDraft((state) => ({ ...state, at: applyLocalTime(state.at, hour, minute) }))} /></View>}
      {!future ? <Text variant="footnote" color="danger" align="center" accessibilityLiveRegion="polite" style={styles.rail}>Pick a time in the future.</Text> : null}
    </View>
    <PanelActions confirmLabel="Remind" onConfirm={() => onConfirm(at)} onCancel={onDismiss} loading={busy} confirmDisabled={!future || busy} topSpacing={16} />
  </FloatingPanel>;
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: spacing[8] },
  rail: { marginHorizontal: spacing[16] },
  body: { gap: spacing[12] },
});
