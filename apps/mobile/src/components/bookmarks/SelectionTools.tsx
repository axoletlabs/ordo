/**
 * Bottom toolbar and confirmations for multi-select. Action set shrinks to
 * what every selected item can do: bookmarks get read/move/tags/copy/delete;
 * folders get pin/delete; a mix only deletes.
 */
import React, { useState } from "react";
import type { BookmarkDto, FolderDto } from "@ordo/shared";
import { SelectionActionBar, type SelectionAction } from "./SelectionActionBar";
import { AddTagsSheet } from "./AddTagsSheet";
import { MoveSheet } from "./MoveSheet";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useBatchBookmarks } from "../../hooks/use-bookmarks";
import { useBatchFolders } from "../../hooks/use-folders";
import { copyLinks } from "../../lib/copy-link";
import { markedAsReadToast, markedAsUnreadToast } from "../../lib/copy";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { deleteUndoable } from "../../lib/undoable-delete";
import { toast } from "../ui/toast-store";
import { layout } from "../../theme/tokens";

export function SelectionTools({
  active,
  bookmarks,
  folders = [],
  fromFolderId,
  onFinished,
  bottom,
  maxWidth = layout.maxContentWidth,
}: {
  active: boolean;
  bookmarks: readonly BookmarkDto[];
  folders?: readonly FolderDto[];
  fromFolderId: string | null;
  onFinished: () => void;
  bottom: number;
  maxWidth?: number;
}) {
  const batchBookmarks = useBatchBookmarks();
  const batchFolders = useBatchFolders();
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const busy = batchBookmarks.isPending || batchFolders.isPending;
  const empty = bookmarks.length === 0 && folders.length === 0;
  const mixed = bookmarks.length > 0 && folders.length > 0;
  const bookmarksOnly = bookmarks.length > 0 && folders.length === 0;
  const foldersOnly = folders.length > 0 && bookmarks.length === 0;
  const allRead = bookmarksOnly && bookmarks.every((bookmark) => bookmark.isRead);
  const allPinned = foldersOnly && folders.every((folder) => folder.pinned);

  const runBookmarks = async (
    action: "delete" | "markRead" | "markUnread",
    success: string,
  ) => {
    try {
      haptics.medium();
      await batchBookmarks.mutateAsync({
        action,
        ids: bookmarks.map((bookmark) => bookmark.id),
        scopeFolderId: fromFolderId,
      });
      toast.success(success);
      onFinished();
    } catch (cause) {
      haptics.error();
      toast.error(errorMessage(cause));
    }
  };

  const runFolders = async (action: "delete" | "pin", pinned?: boolean, success?: string) => {
    try {
      haptics.medium();
      await batchFolders.mutateAsync({
        action,
        ids: folders.map((folder) => folder.id),
        pinned,
      });
      if (success) toast.success(success);
      onFinished();
    } catch (cause) {
      haptics.error();
      toast.error(errorMessage(cause));
    }
  };

  const deleteTitle = mixed
    ? `Delete ${folders.length} ${folders.length === 1 ? "folder" : "folders"} and ${bookmarks.length} ${bookmarks.length === 1 ? "bookmark" : "bookmarks"}?`
    : foldersOnly
      ? folders.length === 1
        ? `Delete ${folders[0].name}?`
        : `Delete ${folders.length} folders?`
      : bookmarks.length === 1
        ? "Delete this bookmark?"
        : `Delete ${bookmarks.length} bookmarks?`;

  const deleteMessage = mixed
    ? "Folders and their bookmarks will be deleted, along with the selected bookmarks. You can undo this."
    : foldersOnly
      ? folders.some((folder) => folder.bookmarkCount > 0)
        ? "Folders and every bookmark inside them will be deleted. You can undo this."
        : "You can undo this."
      : "You can undo this.";

  const actions: SelectionAction[] = [];
  if (active) {
    const disabled = empty || busy;
    if (bookmarksOnly) {
      actions.push({
        key: "read",
        icon: allRead ? "radio-button-off" : "checkmark-circle",
        label: allRead ? "Unread" : "Read",
        disabled,
        onPress: () =>
          void runBookmarks(
            allRead ? "markUnread" : "markRead",
            allRead ? markedAsUnreadToast(bookmarks.length) : markedAsReadToast(bookmarks.length),
          ),
      });
      actions.push({
        key: "move",
        icon: "folder-open-outline",
        label: "Move",
        disabled,
        onPress: () => setMoveOpen(true),
      });
      actions.push({
        key: "tags",
        icon: "pricetags-outline",
        label: "Tags",
        disabled,
        onPress: () => setTagsOpen(true),
      });
      actions.push({
        key: "copy",
        icon: "link-outline",
        label: "Copy",
        disabled,
        onPress: () => {
          void copyLinks(bookmarks.map((bookmark) => bookmark.url));
        },
      });
    } else if (foldersOnly) {
      actions.push({
        key: "pin",
        icon: allPinned ? "pin" : "pin-outline",
        label: allPinned ? "Unpin" : "Pin",
        disabled,
        onPress: () =>
          void runFolders("pin", !allPinned, allPinned ? "Folders unpinned" : "Folders pinned"),
      });
    }
    actions.push({
      key: "delete",
      icon: "trash-outline",
      label: "Delete",
      danger: true,
      disabled,
      onPress: () => setDeleteOpen(true),
    });
  }

  const confirmDelete = () => {
    haptics.medium();
    const selectedBookmarks = [...bookmarks];
    const selectedFolders = [...folders];
    setDeleteOpen(false);
    onFinished();
    deleteUndoable({
      bookmarks: selectedBookmarks,
      folders: selectedFolders,
      scopeFolderId: fromFolderId,
    });
  };

  return (
    <>
      {active ? (
        <SelectionActionBar actions={actions} bottom={bottom} maxWidth={maxWidth} />
      ) : null}

      <MoveSheet
        visible={moveOpen}
        bookmarks={[...bookmarks]}
        fromFolderId={fromFolderId}
        onDismiss={() => setMoveOpen(false)}
        onMoved={onFinished}
      />

      <AddTagsSheet
        visible={tagsOpen}
        bookmarkIds={bookmarks.map((bookmark) => bookmark.id)}
        folderId={fromFolderId}
        onDismiss={() => setTagsOpen(false)}
        onAdded={onFinished}
      />

      <ConfirmDialog
        visible={deleteOpen}
        icon="trash-outline"
        title={deleteTitle}
        message={deleteMessage}
        confirmLabel={
          mixed
            ? "Delete"
            : foldersOnly
              ? folders.length === 1
                ? "Delete folder"
                : "Delete folders"
              : bookmarks.length === 1
                ? "Delete bookmark"
                : "Delete bookmarks"
        }
        loading={busy}
        onDismiss={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
