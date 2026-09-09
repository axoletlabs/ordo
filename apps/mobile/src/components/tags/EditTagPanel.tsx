/**
 * Rename and/or recolor an existing tag.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import type { TagColor, TagDto } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { TagColorPicker } from "./TagColorPicker";
import { PanelActions } from "../ui/SheetActionRow";
import { useUpdateTag } from "../../hooks/use-tags";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { toast } from "../ui/toast-store";
import { spacing } from "../../theme/tokens";

export interface EditTagPanelProps {
  visible: boolean;
  tag: TagDto | null;
  onDismiss: () => void;
}

export function EditTagPanel({ visible, tag, onDismiss }: EditTagPanelProps) {
  const update = useUpdateTag();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible && tag) {
      setName(tag.name);
      setColor(tag.color);
      setError("");
    }
  }, [visible, tag]);

  const save = async () => {
    if (!tag) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a tag name.");
      return;
    }
    const changed = trimmed !== tag.name || color !== tag.color;
    if (!changed) {
      onDismiss();
      return;
    }
    try {
      await update.mutateAsync({
        id: tag.id,
        input: {
          ...(trimmed !== tag.name ? { name: trimmed } : {}),
          ...(color !== tag.color ? { color } : {}),
        },
      });
      haptics.success();
      toast.success("Tag updated");
      onDismiss();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    }
  };

  return (
    <FloatingPanel visible={visible && !!tag} onDismiss={onDismiss}>
      <PanelHeader title="Edit tag" />
      <Input
        value={name}
        onChangeText={setName}
        placeholder="Tag name"
        autoCapitalize="words"
        error={error || undefined}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      <Text variant="label" color="tertiary" style={styles.label}>Color</Text>
      <TagColorPicker value={color} onChange={setColor} />
      <PanelActions
        confirmLabel="Save"
        onConfirm={() => void save()}
        onCancel={onDismiss}
        loading={update.isPending}
      />
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: spacing[10], marginBottom: spacing[6] },
});
