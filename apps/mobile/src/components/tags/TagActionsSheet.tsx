/**
 * Edit / delete a tag from the catalogue list or a tag's own header.
 */
import React, { useState } from "react";
import type { TagDto } from "@ordo/shared";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EditTagPanel } from "./EditTagPanel";
import { useDeleteTag } from "../../hooks/use-tags";
import { haptics } from "../../lib/haptics";
import type { MenuAnchorRect } from "../../lib/menu-anchor";

type Mode = "menu" | "edit" | "delete";

export interface TagActionsSheetProps {
  visible: boolean;
  tag: TagDto | null;
  anchor?: MenuAnchorRect | null;
  onDismiss: () => void;
  onDeleted?: () => void;
}

export function TagActionsSheet({
  visible,
  tag,
  anchor,
  onDismiss,
  onDeleted,
}: TagActionsSheetProps) {
  const deleteTag = useDeleteTag();
  const [mode, setMode] = useState<Mode>("menu");
  const tagRef = React.useRef(tag);
  if (tag) tagRef.current = tag;
  const display = tag ?? tagRef.current;

  React.useEffect(() => {
    if (visible) setMode("menu");
  }, [visible]);

  if (!display) return null;

  return (
    <>
      <ContextMenu visible={visible && mode === "menu"} onDismiss={onDismiss} anchor={anchor ?? null}>
        <ContextMenuItem
          icon="create-outline"
          label="Edit tag"
          onPress={() => setMode("edit")}
        />
        <ContextMenuItem
          icon="trash-outline"
          label="Delete tag"
          tone="danger"
          onPress={() => setMode("delete")}
        />
      </ContextMenu>

      <EditTagPanel
        visible={visible && mode === "edit"}
        tag={display}
        onDismiss={onDismiss}
      />

      <ConfirmDialog
        visible={visible && mode === "delete"}
        icon="trash-outline"
        onDismiss={onDismiss}
        title={
          display.bookmarkCount > 0
            ? `Delete "${display.name}" from ${display.bookmarkCount} bookmarks?`
            : `Delete "${display.name}"?`
        }
        message="The tag is removed. Bookmarks are kept. You can undo this."
        confirmLabel="Delete tag"
        onConfirm={() => {
          haptics.medium();
          const target = display;
          onDismiss();
          deleteTag.mutate(target, { onDeleted });
        }}
      />
    </>
  );
}
