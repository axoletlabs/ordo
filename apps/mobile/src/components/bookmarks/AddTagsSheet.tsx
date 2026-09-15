/**
 * Add tags to every selected bookmark. Existing tags are kept; new ones are unioned.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Text } from "../ui/Text";
import { PanelActions } from "../ui/SheetActionRow";
import { TagSelectList } from "../tags/TagSelectList";
import { CreateTagPanel } from "../tags/CreateTagPanel";
import { useBatchBookmarks } from "../../hooks/use-bookmarks";
import { addedTagsToast } from "../../lib/copy";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { toast } from "../ui/toast-store";
import { spacing } from "../../theme/tokens";

export function AddTagsSheet({
  visible,
  onDismiss,
  bookmarkIds,
  folderId,
  onAdded,
}: {
  visible: boolean;
  onDismiss: () => void;
  bookmarkIds: readonly string[];
  folderId?: string | null;
  onAdded?: () => void;
}) {
  const batch = useBatchBookmarks();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible) {
      setSelectedIds([]);
      setCreateTagOpen(false);
      setError("");
    }
  }, [visible]);

  const toggle = (tagId: string) => {
    haptics.selection();
    setSelectedIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  const save = async () => {
    if (selectedIds.length === 0 || bookmarkIds.length === 0) return;
    try {
      await batch.mutateAsync({
        action: "addTags",
        ids: [...bookmarkIds],
        tagIds: selectedIds,
        scopeFolderId: folderId,
      });
      haptics.success();
      toast.success(addedTagsToast(bookmarkIds.length));
      onAdded?.();
      onDismiss();
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause));
    }
  };

  return (
    <>
      <FloatingPanel visible={visible} onDismiss={onDismiss}>
        <PanelHeader title="Add tags" />
        <TagSelectList
          selectedIds={selectedIds}
          onToggle={toggle}
          onRequestCreateTag={() => setCreateTagOpen(true)}
        />
        {error ? (
          <Text variant="footnote" color="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <PanelActions
          confirmLabel="Add tags"
          onConfirm={() => void save()}
          onCancel={onDismiss}
          loading={batch.isPending}
          confirmDisabled={selectedIds.length === 0}
        />
      </FloatingPanel>
      <CreateTagPanel
        visible={visible && createTagOpen}
        onDismiss={() => setCreateTagOpen(false)}
        onCreated={(tag) => toggle(tag.id)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  error: { marginTop: spacing[8] },
});
