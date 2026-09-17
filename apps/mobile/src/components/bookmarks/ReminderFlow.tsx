import React, { useMemo } from "react";
import type { BookmarkDto } from "@ordo/shared";
import { ContextMenu, ContextMenuItem, ContextMenuNote, type MenuAnchorRect } from "../ui/ContextMenu";
import { useSetBookmarkReminder } from "../../hooks/use-bookmarks";
import { useOverlaySessionMode } from "../../lib/overlay-session-mode";
import { errorMessage } from "../../lib/error-message";
import { toast } from "../ui/toast-store";
import {
  REMINDER_PRESETS,
  formatReminderWhen,
  reminderClearedToast,
  reminderPresetAt,
  reminderPresetDetail,
  reminderSetToast,
} from "../../lib/bookmark-reminders";
import { ReminderCustomPanel } from "./ReminderCustomPanel";

export function ReminderFlow({
  visible,
  bookmark,
  anchor,
  onDismiss,
  showBack,
  onBack,
}: {
  visible: boolean;
  bookmark: BookmarkDto | null;
  anchor: MenuAnchorRect | null;
  onDismiss: () => void;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const setReminder = useSetBookmarkReminder();
  const [page, setPage] = useOverlaySessionMode<"presets" | "custom">(visible, "presets");
  const bookmarkRef = React.useRef(bookmark);
  if (bookmark) bookmarkRef.current = bookmark;
  const target = bookmark ?? bookmarkRef.current;
  const now = useMemo(() => new Date(), [visible, target?.remindAt, target?.id]);
  const note = target?.remindAt != null ? formatReminderWhen(target.remindAt, now) : null;

  const save = (remindAt: number | null) => {
    if (!target) return;
    setReminder.mutate(
      { id: target.id, folderId: target.folderId, title: target.title, remindAt },
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

  if (!target) return null;

  return (
    <>
      <ContextMenu
        visible={visible && page === "presets"}
        onDismiss={onDismiss}
        anchor={anchor}
        width={280}
        estimatedHeight={320}
      >
        {showBack ? (
          <ContextMenuItem icon="chevron-back" label="Back" onPress={() => onBack?.()} />
        ) : null}
        {note ? <ContextMenuNote>{note}</ContextMenuNote> : null}
        {REMINDER_PRESETS.map((preset) => {
          const at = reminderPresetAt(preset.id, now);
          return (
            <ContextMenuItem
              key={preset.id}
              label={preset.label}
              detail={reminderPresetDetail(preset.id, at)}
              disabled={setReminder.isPending}
              onPress={() => save(at)}
            />
          );
        })}
        <ContextMenuItem
          label="Custom…"
          disabled={setReminder.isPending}
          onPress={() => setPage("custom")}
        />
        {target.remindAt != null ? (
          <ContextMenuItem
            icon="close-circle-outline"
            label="Clear reminder"
            tone="danger"
            disabled={setReminder.isPending}
            onPress={() => save(null)}
          />
        ) : null}
      </ContextMenu>
      <ReminderCustomPanel
        visible={visible && page === "custom"}
        initialUnix={target.remindAt}
        busy={setReminder.isPending}
        onDismiss={() => setPage("presets")}
        onConfirm={(unix) => save(unix)}
      />
    </>
  );
}
