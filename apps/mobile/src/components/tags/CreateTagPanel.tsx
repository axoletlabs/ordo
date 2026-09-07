/**
 * Create a new reusable tag inline (name + curated color).
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { DEFAULT_TAG_COLOR, type TagColor, type TagDto } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { TagColorPicker } from "./TagColorPicker";
import { sheetMenuStyles } from "../ui/SheetActionRow";
import { useCreateTag } from "../../hooks/use-tags";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { spacing } from "../../theme/tokens";

export interface CreateTagPanelProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated?: (tag: TagDto) => void;
}

export function CreateTagPanel({ visible, onDismiss, onCreated }: CreateTagPanelProps) {
  const create = useCreateTag();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>(DEFAULT_TAG_COLOR);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible) {
      setName("");
      setColor(DEFAULT_TAG_COLOR);
      setError("");
    }
  }, [visible]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a tag name.");
      return;
    }
    try {
      const tag = await create.mutateAsync({ name: trimmed, color });
      haptics.success();
      onCreated?.(tag);
      onDismiss();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    }
  };

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss}>
      <PanelHeader title="New tag" />
      <Input
        value={name}
        onChangeText={setName}
        placeholder="Tag name"
        autoFocus
        autoCapitalize="words"
        error={error || undefined}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Text variant="label" color="tertiary" style={styles.label}>Color</Text>
      <TagColorPicker value={color} onChange={setColor} />
      <View style={sheetMenuStyles.row}>
        <Button label="Cancel" variant="secondary" onPress={onDismiss} style={{ flex: 1 }} />
        <Button label="Create" onPress={submit} loading={create.isPending} style={{ flex: 1.4 }} />
      </View>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: spacing[10], marginBottom: spacing[6] },
});
