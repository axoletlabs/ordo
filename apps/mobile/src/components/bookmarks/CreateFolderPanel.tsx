/**
 * Floating dialog to create a folder: name + icon, optimistic create.
 * Shared by the library home header action and the save-bookmark sheet.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { FolderIconPicker } from "./FolderIconPicker";
import { PanelActions } from "../ui/SheetActionRow";
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
  const [iconOpen, setIconOpen] = useState(false);

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
      obscured={iconOpen}
      onDismiss={close}
    >
      <ThemedScrollView keyboardShouldPersistTaps="handled">
        <PanelHeader title="New folder" />
        <View style={styles.body}>
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Recipes"
            autoFocus
            error={error || undefined}
            onSubmitEditing={submit}
          />
          <FolderIconPicker value={icon} onChange={setIcon} onOpenChange={setIconOpen} />
        </View>
        <PanelActions
          confirmLabel="Create folder"
          onConfirm={() => void submit()}
          onCancel={close}
          loading={createFolder.isPending}
        />
      </ThemedScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing[16] },
});
