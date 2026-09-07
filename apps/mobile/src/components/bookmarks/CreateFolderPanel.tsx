/**
 * Floating dialog to create a folder: name + icon, optimistic create.
 * Shared by the library home header action and the save-bookmark sheet.
 */
import React, { useState } from "react";
import { ScrollView, StyleSheet, View, type TextInput } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { FolderIconPicker } from "./FolderIconPicker";
import { sheetMenuStyles } from "../ui/SheetActionRow";
import { useCreateFolder } from "../../hooks/use-folders";
import { haptics } from "../../lib/haptics";
import { errorMessage } from "../../lib/error-message";
import { spacing } from "../../theme/tokens";
import { DEFAULT_FOLDER_ICON, type FolderDto, type FolderIcon } from "@ordo/shared";

export function CreateFolderPanel({
  visible,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  onDismiss: () => void;
  onCreated?: (folder: FolderDto) => void;
}) {
  const createFolder = useCreateFolder();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<FolderIcon>(DEFAULT_FOLDER_ICON);
  const [error, setError] = useState("");
  const nameRef = React.useRef<TextInput>(null);

  const close = () => {
    setName("");
    setIcon(DEFAULT_FOLDER_ICON);
    setError("");
    onDismiss();
  };

  const submit = async () => {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a folder name.");
      return;
    }
    try {
      const folder = await createFolder.mutateAsync({ name: trimmed, icon });
      haptics.success();
      onCreated?.(folder);
      close();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={close}
      onShow={() => setTimeout(() => nameRef.current?.focus(), 100)}
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <PanelHeader title="New folder" />
        <Input
          ref={nameRef}
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Recipes"
          autoFocus
          error={error || undefined}
          onSubmitEditing={submit}
        />
        <Text variant="label" color="tertiary" style={styles.iconLabel}>Icon</Text>
        <FolderIconPicker value={icon} onChange={setIcon} />
        <View style={sheetMenuStyles.stack}>
          <Button label="Create folder" block size="lg" onPress={submit} loading={createFolder.isPending} />
          <Button label="Cancel" variant="ghost" block onPress={close} />
        </View>
      </ScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  iconLabel: { marginTop: spacing[10], marginBottom: spacing[6] },
});
