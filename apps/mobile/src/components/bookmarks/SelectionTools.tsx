/**
 * Bottom toolbar and confirmations for multi-select. Action set shrinks to
 * what every selected item can do: bookmarks get read/move/more/delete (tags
 * and copy live in the More menu); folders get pin/delete; a mix only deletes.
 */
import React, { useMemo, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { BookmarkDto, FolderDto } from "@ordo/shared";
import { SelectionActionBar, type SelectionAction } from "./SelectionActionBar";
import { AddTagsSheet } from "./AddTagsSheet";
import { MoveSheet } from "./MoveSheet";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { useBatchBookmarks } from "../../hooks/use-bookmarks";
import { useBatchFolders } from "../../hooks/use-folders";
import { copyLinks } from "../../lib/copy-link";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { markedAsReadToast, markedAsUnreadToast } from "../../lib/copy";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { deleteUndoable } from "../../lib/undoable-delete";
import { toast } from "../ui/toast-store";
import { layout } from "../../theme/tokens";
import type { SelectionStore } from "../../lib/selection-state";
import { indexSelectionItems, selectedItems, selectionCapabilities } from "../../lib/selection-items";
import { prepActionSheets } from "../../hooks/use-action-sheet-prep";
import { LazyMount } from "../ui/LazyMount";

const noFolders: readonly FolderDto[] = [];

interface SelectionToolsProps {
  store: SelectionStore;
  active: boolean;
  bookmarks: readonly BookmarkDto[];
  folders?: readonly FolderDto[];
  fromFolderId: string | null;
  onFinished: () => void;
  bottom: number;
  maxWidth?: number;
}

export function SelectionTools(props: SelectionToolsProps) {
  // Opening a folder needs rows, not a second index and mutation subscriptions
  // for a toolbar that has never been used. Retain it after first selection.
  return <LazyMount active={props.active}>{() => <SelectionToolsContent {...props} />}</LazyMount>;
}

function SelectionToolsContent({
  store,
  active,
  bookmarks: candidateBookmarks,
  folders: candidateFolders = noFolders,
  fromFolderId,
  onFinished,
  bottom,
  maxWidth = layout.maxContentWidth,
}: SelectionToolsProps) {
  const batchBookmarks = useBatchBookmarks();
  const batchFolders = useBatchFolders();
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [more, setMore] = useState<{ open: boolean; anchor: MenuAnchorRect | null }>({ open: false, anchor: null });
  const busy = batchBookmarks.isPending || batchFolders.isPending;
  const items = useMemo(() => indexSelectionItems(candidateBookmarks, candidateFolders), [candidateBookmarks, candidateFolders]);
  const { empty, bookmarksOnly, foldersOnly, allRead, allPinned } = useStore(store,
    useShallow(state => selectionCapabilities(state.ids, items)));
  const getSelected = () => selectedItems(store.getState().ids, items);
  // Dialogs retain a snapshot through exit. Dragging must neither recreate
  // their props on every row crossing nor change a pending bulk operation.
  const [{ bookmarks, folders }, setSnapshot] = useState<{ bookmarks: BookmarkDto[]; folders: FolderDto[] }>({ bookmarks: [], folders: [] });
  const captureSelection = () => setSnapshot(getSelected());
  const mixed = bookmarks.length > 0 && folders.length > 0;
  const snapshotFoldersOnly = folders.length > 0 && bookmarks.length === 0;

  const runBookmarks = async (
    action: "delete" | "markRead" | "markUnread",
  ) => {
    const { bookmarks } = getSelected();
    try {
      haptics.medium();
      await batchBookmarks.mutateAsync({
        action,
        ids: bookmarks.map((bookmark) => bookmark.id),
        scopeFolderId: fromFolderId,
      });
      toast.success(action === "markUnread" ? markedAsUnreadToast(bookmarks.length) : markedAsReadToast(bookmarks.length));
      onFinished();
    } catch (cause) {
      haptics.error();
      toast.error(errorMessage(cause));
    }
  };

  const runFolders = async (action: "delete" | "pin", pinned?: boolean, success?: string) => {
    const { folders } = getSelected();
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
    : snapshotFoldersOnly
      ? folders.length === 1
        ? `Delete ${folders[0].name}?`
        : `Delete ${folders.length} folders?`
      : bookmarks.length === 1
        ? "Delete this bookmark?"
        : `Delete ${bookmarks.length} bookmarks?`;

  const deleteMessage = mixed
    ? "Folders and their bookmarks will be deleted, along with the selected bookmarks. You can undo this."
    : snapshotFoldersOnly
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
        onPress: () => void runBookmarks(allRead ? "markUnread" : "markRead"),
      });
      actions.push({
        key: "move",
        icon: "folder-open-outline",
        label: "Move",
        disabled,
        onPress: () => { captureSelection(); setMoveOpen(true); },
      });
      // Tags and copy are real but secondary in bulk workflows; keeping them
      // out of the bar leaves four roomy pills on a narrow phone instead of
      // five crowded ones. The menu anchors to the More pill itself.
      actions.push({
        key: "more",
        icon: "ellipsis-horizontal",
        label: "More",
        disabled,
        onPress: (trigger) => { captureSelection(); measureAnchor(trigger, (anchor) => setMore({ open: true, anchor })); },
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
      onPress: () => { captureSelection(); setDeleteOpen(true); },
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
      <SelectionActionBar actions={actions} bottom={bottom} maxWidth={maxWidth} />

      <MoveSheet
        visible={moveOpen}
        bookmarks={[...bookmarks]}
        fromFolderId={fromFolderId}
        onDismiss={() => setMoveOpen(false)}
        onMoved={onFinished}
      />

      <ContextMenu
        visible={more.open}
        onDismiss={() => setMore({ open: false, anchor: null })}
        anchor={more.anchor}
        preferredPlacement="above"
        estimatedHeight={128}
      >
        <ContextMenuItem
          icon="pricetags-outline"
          label="Add tags"
          disabled={empty || busy}
          onPress={() => {
            // Mount the sheet in this press commit so the More menu's exit
            // window covers it; the handoff lands on a prepared surface.
            prepActionSheets("addTags");
            setMore({ open: false, anchor: null });
            setTagsOpen(true);
          }}
        />
        <ContextMenuItem
          icon="link-outline"
          label="Copy links"
          disabled={empty || busy}
          onPress={() => {
            setMore({ open: false, anchor: null });
            void copyLinks(bookmarks.map((bookmark) => bookmark.url));
          }}
        />
      </ContextMenu>

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
        confirmLabel="Delete"
        loading={busy}
        onDismiss={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
