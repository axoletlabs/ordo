import React, { useEffect } from "react";
import { useRouter } from "expo-router";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Text } from "../ui/Text";
import { copyLink } from "../../lib/copy-link";
import { ackBookmarkOpened, openLivePage } from "../../lib/open-website";
import { useSettingsStore } from "../../store/settings";
import { bookmarkCanBeArticle, bookmarkIsArticle } from "../../lib/bookmark-reader";
import * as bookmarkHooks from "../../hooks/use-bookmarks";
import { toast } from "../ui/toast-store";
import { errorMessage } from "../../lib/error-message";
import { bookmarkKey } from "../../hooks/use-selection";
import { useMenuHighlightStore } from "../../hooks/use-menu-highlight";
import { useOverlaySessionMode } from "../../lib/overlay-session-mode";
import { useServerInfo } from "../../hooks/queries";
import { formatReminderWhen } from "../../lib/bookmark-reminders";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import type { BookmarkDto } from "@ordo/shared";
import { ReminderCustomPanel } from "./ReminderCustomPanel";
import { ReminderPresetItems, useSaveReminder } from "./ReminderFlow";

function useSetContentKindMissing() {
  return { mutate: () => undefined, isPending: false };
}

const useSetContentKind =
  typeof bookmarkHooks.useSetContentKind === "function"
    ? bookmarkHooks.useSetContentKind
    : useSetContentKindMissing;

export interface BookmarkActionsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  bookmark: BookmarkDto | null;
  anchor: MenuAnchorRect | null;
  onToggleRead: (bookmark: BookmarkDto) => void;
  onMove: (bookmark: BookmarkDto) => void;
  onDelete: (bookmark: BookmarkDto) => void;
  onEditTags?: (bookmark: BookmarkDto) => void;
}

export function BookmarkActionsSheet({
  visible,
  onDismiss,
  bookmark,
  anchor,
  onToggleRead,
  onMove,
  onDelete,
  onEditTags,
}: BookmarkActionsSheetProps) {
  const router = useRouter();
  const setContentKind = useSetContentKind();
  const [mode, setMode] = useOverlaySessionMode<"menu" | "remind" | "delete">(visible, "menu");
  const [remindPage, setRemindPage] = useOverlaySessionMode<"presets" | "custom">(
    visible && mode === "remind",
    "presets",
  );
  const serverInfo = useServerInfo();
  const remindersSupported = serverInfo.data?.reminders === true;
  const bookmarkRef = React.useRef(bookmark);
  if (bookmark) bookmarkRef.current = bookmark;
  const displayBookmark = bookmark ?? bookmarkRef.current;
  const { save: saveReminder, busy: reminderBusy } = useSaveReminder(displayBookmark, onDismiss);
  const remindNow = React.useMemo(
    () => new Date(),
    [visible, mode, displayBookmark?.id, displayBookmark?.remindAt],
  );

  useEffect(() => {
    if (!visible || !displayBookmark) return;
    const key = bookmarkKey(displayBookmark.id);
    useMenuHighlightStore.getState().set(key);
    return () => {
      const store = useMenuHighlightStore.getState();
      if (store.key === key) store.set(null);
    };
  }, [visible, displayBookmark]);

  if (!displayBookmark) return null;

  return (
    <>
      <ContextMenu
        visible={visible && (mode === "menu" || (mode === "remind" && remindPage === "presets"))}
        onDismiss={onDismiss}
        anchor={anchor}
        sessionKey={visible ? displayBookmark.id : undefined}
      >
        {mode === "remind" ? (
          <ReminderPresetItems
            bookmark={displayBookmark}
            now={remindNow}
            busy={reminderBusy}
            showBack
            onBack={() => setMode("menu")}
            onPick={saveReminder}
            onCustom={() => setRemindPage("custom")}
          />
        ) : (
          <>
        <ContextMenuItem
          icon={displayBookmark.isRead ? "radio-button-off" : "checkmark-circle"}
          label={displayBookmark.isRead ? "Mark as unread" : "Mark as read"}
          onPress={() => {
            onToggleRead(displayBookmark);
            onDismiss();
          }}
        />
        <ContextMenuItem
          icon="folder-open-outline"
          label="Move to folder"
          onPress={() => {
            onMove(displayBookmark);
            onDismiss();
          }}
        />
        {onEditTags ? (
          <ContextMenuItem
            icon="pricetags-outline"
            label="Edit tags"
            onPress={() => {
              onEditTags(displayBookmark);
              onDismiss();
            }}
          />
        ) : null}
        {remindersSupported ? (
          <ContextMenuItem
            icon="alarm-outline"
            label={displayBookmark.remindAt != null ? "Edit reminder" : "Remind"}
            trailing={
              displayBookmark.remindAt != null ? (
                <Text variant="monoSmall" color="tertiary" numberOfLines={1}>
                  {formatReminderWhen(displayBookmark.remindAt)}
                </Text>
              ) : undefined
            }
            onPress={() => setMode("remind")}
          />
        ) : null}
        <ContextMenuItem
          icon="link-outline"
          label="Copy link"
          onPress={() => {
            void copyLink(displayBookmark.url);
            onDismiss();
          }}
        />
        <ContextMenuItem
          icon="globe-outline"
          label="Open original"
          onPress={() => {
            const browser = useSettingsStore.getState().websiteBrowser;
            if (browser === "ordo") {
              router.push({
                pathname: "/reader/[id]",
                params: { id: displayBookmark.id, view: "browser" },
              });
              if (!displayBookmark.isRead) onToggleRead(displayBookmark);
            } else {
              ackBookmarkOpened(displayBookmark);
              void openLivePage(displayBookmark.url, browser);
            }
            onDismiss();
          }}
        />
        {typeof bookmarkHooks.useSetContentKind === "function" && bookmarkIsArticle(displayBookmark) ? (
          <ContextMenuItem
            icon="globe-outline"
            label="Mark as website"
            onPress={() => {
              setContentKind.mutate(
                {
                  id: displayBookmark.id,
                  folderId: displayBookmark.folderId,
                  contentKindOverride: "web",
                },
                {
                  onSuccess: () => toast.success("Saved as a website"),
                  onError: (err) => toast.error(errorMessage(err, "Couldn't update this bookmark.")),
                },
              );
              onDismiss();
            }}
          />
        ) : typeof bookmarkHooks.useSetContentKind === "function" && bookmarkCanBeArticle(displayBookmark) ? (
          <ContextMenuItem
            icon="reader-outline"
            label="Mark as article"
            onPress={() => {
              setContentKind.mutate(
                {
                  id: displayBookmark.id,
                  folderId: displayBookmark.folderId,
                  contentKindOverride: "article",
                },
                {
                  onSuccess: () => toast.success("Saved as an article"),
                  onError: (err) => toast.error(errorMessage(err, "Couldn't update this bookmark.")),
                },
              );
              onDismiss();
            }}
          />
        ) : null}
        <ContextMenuItem
          icon="trash-outline"
          label="Delete bookmark"
          tone="danger"
          onPress={() => setMode("delete")}
        />
          </>
        )}
      </ContextMenu>
      <ReminderCustomPanel
        visible={visible && mode === "remind" && remindPage === "custom"}
        initialUnix={displayBookmark.remindAt}
        busy={reminderBusy}
        onDismiss={() => setRemindPage("presets")}
        onConfirm={(unix) => saveReminder(unix)}
      />
      <ConfirmDialog
        visible={visible && mode === "delete"}
        icon="trash-outline"
        title="Delete this bookmark?"
        message="You can undo this."
        confirmLabel="Delete"
        onDismiss={() => setMode("menu")}
        onConfirm={() => {
          onDelete(displayBookmark);
          onDismiss();
        }}
      />
    </>
  );
}
