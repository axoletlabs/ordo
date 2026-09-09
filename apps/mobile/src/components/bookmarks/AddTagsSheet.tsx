/**
 * Add tags to every selected bookmark. Existing tags are kept; new ones are unioned.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
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

  const count = bookmarkIds.length;

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
        <View style={styles.actions}>
          <Button label="Cancel" variant="secondary" onPress={onDismiss} style={{ flex: 1 }} />
          <Button
            label={count === 1 ? "Add tags" : `Add to ${count}`}
            onPress={() => void save()}
            loading={batch.isPending}
            disabled={selectedIds.length === 0}
            style={{ flex: 1 }}
          />
        </View>
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
  actions: { flexDirection: "row", gap: spacing[8], marginTop: spacing[12] },
});
