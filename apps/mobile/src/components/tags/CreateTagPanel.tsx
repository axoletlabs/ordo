/**
 * Create a new reusable tag inline (name + curated color).
 * The fields and their submit are shared with the save sheet, which renders
 * them as a page of its own surface.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { DEFAULT_TAG_COLOR, TAG_NAME_MAX_LENGTH, type TagColor, type TagDto } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { TagColorPicker } from "./TagColorPicker";
import { PanelActions } from "../ui/SheetActionRow";
import { useCreateTag } from "../../hooks/use-tags";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { spacing } from "../../theme/tokens";

export interface CreateTagPanelProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated?: (tag: TagDto) => void;
}

/** Tag-create fields and submit, for a caller that owns the surface header and
 * actions. Values survive page changes inside one open surface. */
export function useCreateTagForm(visible: boolean, onCreated?: (tag: TagDto) => void) {
  const create = useCreateTag();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>(DEFAULT_TAG_COLOR);
  const [error, setError] = useState("");
  const submitting = React.useRef(false);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setColor(DEFAULT_TAG_COLOR);
    setError("");
  }, [visible]);

  const submit = async () => {
    if (submitting.current || create.isPending) return;
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a tag name.");
      return;
    }
    submitting.current = true;
    try {
      const tag = await create.mutateAsync({ name: trimmed, color });
      haptics.success();
      setName("");
      setColor(DEFAULT_TAG_COLOR);
      onCreated?.(tag);
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    } finally {
      submitting.current = false;
    }
  };

  return { name, setName, color, setColor, error, submit, busy: create.isPending };
}

export function CreateTagPanel({ visible, onDismiss, onCreated }: CreateTagPanelProps) {
  const form = useCreateTagForm(visible, (tag) => {
    onCreated?.(tag);
    onDismiss();
  });

  return (
    <FloatingPanel dirty={form.color !== DEFAULT_TAG_COLOR} visible={visible} onDismiss={onDismiss} dismissible={!form.busy}>
      <PanelHeader title="New tag" />
      <View style={styles.body}>
        <Input
          label="Tag name"
          required maxLength={TAG_NAME_MAX_LENGTH} showCounter
          value={form.name}
          disabled={form.busy}
          onChangeText={form.setName}
          placeholder="Tag name"
          autoFocus
          autoCapitalize="words"
          error={form.error || undefined}
          returnKeyType="done"
          onSubmitEditing={() => void form.submit()}
        />
        <Text variant="label" color="tertiary" style={styles.label}>Color</Text>
        <TagColorPicker value={form.color} onChange={form.setColor} />
      </View>
      <PanelActions
        confirmLabel="Create"
        onConfirm={() => void form.submit()}
        onCancel={onDismiss}
        loading={form.busy}
      />
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  body: {},
  label: { marginTop: spacing[16], marginBottom: spacing[8] },
});
