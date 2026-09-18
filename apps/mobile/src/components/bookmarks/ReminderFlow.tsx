import React, { useMemo } from "react";
import { Ionicons } from "@expo/vector-icons";
import type { BookmarkDto } from "@ordo/shared";
import { ContextMenu, ContextMenuItem, type MenuAnchorRect } from "../ui/ContextMenu";
import { useSetBookmarkReminder } from "../../hooks/use-bookmarks";
import { useOverlaySessionMode } from "../../lib/overlay-session-mode";
import { errorMessage } from "../../lib/error-message";
import { toast } from "../ui/toast-store";
import {
  REMINDER_PRESETS,
  reminderClearedToast,
  reminderPresetAt,
  reminderPresetDetail,
  reminderSetToast,
  type ReminderPresetId,
} from "../../lib/bookmark-reminders";
import { ReminderCustomPanel } from "./ReminderCustomPanel";

export type ReminderFlowBookmark = Pick<
  BookmarkDto,
  "id" | "folderId" | "title" | "domain" | "remindAt"
>;

const PRESET_ICON: Record<ReminderPresetId, keyof typeof Ionicons.glyphMap> = {
  "1h": "hourglass-outline",
  "3h": "timer-outline",
  tomorrow: "sunny-outline",
  nextWeek: "calendar-outline",
};

export function useSaveReminder(bookmark: ReminderFlowBookmark | null, onDismiss: () => void) {
  const setReminder = useSetBookmarkReminder();
  const bookmarkRef = React.useRef(bookmark);
  if (bookmark) bookmarkRef.current = bookmark;

  const save = (remindAt: number | null) => {
    const target = bookmarkRef.current;
    if (!target) return;
    setReminder.mutate(
      { id: target.id, folderId: target.folderId, title: target.title, domain: target.domain, remindAt },
      {
        onSuccess: (updated) => {
          if (updated.remindAt == null) toast.success(reminderClearedToast());
          else toast.success(reminderSetToast(updated.remindAt));
          onDismiss();
        },
        onError: (err) => toast.error(errorMessage(err, "Couldn't update this reminder.")),
      },
    );
  };

  return { save, busy: setReminder.isPending };
}

/** Preset rows for a parent ContextMenu so Remind does not remount a second panel. */
export function ReminderPresetItems({
  bookmark,
  now,
  busy,
  showBack,
  onBack,
  onPick,
  onCustom,
}: {
  bookmark: ReminderFlowBookmark;
  now: Date;
  busy?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onPick: (remindAt: number | null) => void;
  onCustom: () => void;
}) {
  return (
    <>
      {showBack ? (
        <ContextMenuItem icon="chevron-back" label="Back" onPress={() => onBack?.()} />
      ) : null}
      {REMINDER_PRESETS.map((preset) => {
        const at = reminderPresetAt(preset.id, now);
        return (
          <ContextMenuItem
            key={preset.id}
            icon={PRESET_ICON[preset.id]}
            label={preset.label}
            detail={reminderPresetDetail(preset.id, at)}
            disabled={busy}
            onPress={() => onPick(at)}
          />
        );
      })}
      <ContextMenuItem
        icon="calendar-number-outline"
        label="Custom…"
        disabled={busy}
        onPress={onCustom}
      />
      {bookmark.remindAt != null ? (
        <ContextMenuItem
          icon="close-circle-outline"
          label="Clear reminder"
          tone="danger"
          disabled={busy}
          onPress={() => onPick(null)}
        />
      ) : null}
    </>
  );
}

export function ReminderFlow({
  visible,
  bookmark,
  anchor,
  onDismiss,
  showBack,
  onBack,
}: {
  visible: boolean;
  bookmark: ReminderFlowBookmark | null;
  anchor: MenuAnchorRect | null;
  onDismiss: () => void;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const { save, busy } = useSaveReminder(bookmark, onDismiss);
  const [page, setPage] = useOverlaySessionMode<"presets" | "custom">(visible, "presets");
  const bookmarkRef = React.useRef(bookmark);
  if (bookmark) bookmarkRef.current = bookmark;
  const target = bookmark ?? bookmarkRef.current;
  const now = useMemo(() => new Date(), [visible, target?.remindAt, target?.id]);

  if (!target) return null;

  return (
    <>
      <ContextMenu
        visible={visible && page === "presets"}
        onDismiss={onDismiss}
        anchor={anchor}
        estimatedHeight={248}
      >
        <ReminderPresetItems
          bookmark={target}
          now={now}
          busy={busy}
          showBack={showBack}
          onBack={onBack}
          onPick={save}
          onCustom={() => setPage("custom")}
        />
      </ContextMenu>
      <ReminderCustomPanel
        visible={visible && page === "custom"}
        initialUnix={target.remindAt}
        busy={busy}
        onDismiss={() => setPage("presets")}
        onConfirm={(unix) => save(unix)}
      />
    </>
  );
}
