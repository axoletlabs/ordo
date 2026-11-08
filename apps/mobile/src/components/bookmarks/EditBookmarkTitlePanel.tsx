import React, { useLayoutEffect, useRef, useState } from "react";
import { BOOKMARK_TITLE_MAX_LENGTH, type BookmarkDto } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { Input } from "../ui/Input";
import { toast } from "../ui/toast-store";
import { useUpdateBookmarkTitle } from "../../hooks/use-bookmarks";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";

export const EditBookmarkTitlePanel = React.memo(function EditBookmarkTitlePanel({
  visible, bookmark, onDismiss,
}: {
  visible: boolean;
  bookmark: BookmarkDto;
  onDismiss: () => void;
}) {
  const update = useUpdateBookmarkTitle();
  const [title, setTitle] = useState(bookmark.title);
  const [error, setError] = useState("");
  const session = useRef({ visible: false, id: bookmark.id });
  useLayoutEffect(() => {
    if (visible && (!session.current.visible || session.current.id !== bookmark.id)) {
      setTitle(bookmark.title);
      setError("");
    }
    session.current = { visible, id: bookmark.id };
  }, [visible, bookmark.id, bookmark.title]);

  const save = async () => {
    if (!visible || update.isPending) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Enter a title.");
      return;
    }
    if (trimmed.length > BOOKMARK_TITLE_MAX_LENGTH) {
      setError(`Use ${BOOKMARK_TITLE_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (trimmed === bookmark.title) {
      onDismiss();
      return;
    }
    try {
      await update.mutateAsync({ id: bookmark.id, folderId: bookmark.folderId, title: trimmed });
      haptics.success();
      toast.success("Title updated");
      onDismiss();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    }
  };

  return <FloatingPanel visible={visible} onDismiss={onDismiss} dismissible={!update.isPending}>
    <PanelHeader title="Edit title" />
    <Input
      label="Title"
      required
      showRequiredIndicator={false}
      value={title}
      onChangeText={(value) => { setTitle(value); setError(""); }}
      maxLength={BOOKMARK_TITLE_MAX_LENGTH}
      showCounter
      autoFocus={visible}
      selectTextOnFocus
      autoCapitalize="sentences"
      disabled={update.isPending}
      error={error || undefined}
      returnKeyType="done"
      onSubmitEditing={() => void save()}
    />
    <PanelActions confirmLabel="Save" onConfirm={() => void save()} onCancel={onDismiss} loading={update.isPending} />
  </FloatingPanel>;
});
