/**
 * Create a folder: name + icon, optimistic create.
 * Shared by the library home header action and the save-bookmark sheet, which
 * renders the form as a page of its own surface.
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
import { LazyMount } from "../ui/LazyMount";

/** The folder-create fields and their submit, for callers that own the surface
 * header and actions (the save sheet's in-place creation page). State survives
 * moving between pages of one open surface and resets on the next opening. */
export function useCreateFolderForm(visible: boolean, onCreated?: (folder: FolderDto) => void) {
  const createFolder = useCreateFolder();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<FolderIcon>(DEFAULT_FOLDER_ICON);
  const [error, setError] = useState("");
  const submitting = React.useRef(false);

  React.useEffect(() => {
    if (!visible) return;
    setName("");
    setIcon(DEFAULT_FOLDER_ICON);
    setError("");
  }, [visible]);

  const submit = async () => {
    if (submitting.current || createFolder.isPending) return;
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a folder name.");
      return;
    }
    submitting.current = true;
    try {
      const folder = await createFolder.mutateAsync({ name: trimmed, icon });
      haptics.success();
      setName("");
      setIcon(DEFAULT_FOLDER_ICON);
      onCreated?.(folder);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      submitting.current = false;
    }
  };

  return { name, setName, icon, setIcon, error, submit, busy: createFolder.isPending };
}

export function CreateFolderPanel(props: Parameters<typeof CreateFolderContent>[0]) {
  return <LazyMount active={props.visible}>{() => <CreateFolderContent {...props} />}</LazyMount>;
}

function CreateFolderContent({
  visible,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  onDismiss: () => void;
  onCreated?: (folder: FolderDto) => void;
}) {
  const form = useCreateFolderForm(visible, (folder) => {
    onCreated?.(folder);
    onDismiss();
  });
  const [iconOpen, setIconOpen] = useState(false);

  const close = () => {
    if (form.busy) return;
    onDismiss();
  };

  return (
    <FloatingPanel
      visible={visible}
      dirty={form.icon !== DEFAULT_FOLDER_ICON}
      obscured={iconOpen}
      onDismiss={close}
      dismissible={!form.busy}
    >
      <ThemedScrollView keyboardShouldPersistTaps="handled">
        <PanelHeader title="New folder" />
        <View style={styles.body}>
          <Input
            label="Name"
            required showRequiredIndicator={false} maxLength={100} showCounter
            value={form.name}
            disabled={form.busy}
            onChangeText={form.setName}
            placeholder="e.g. Recipes"
            autoFocus
            error={form.error || undefined}
            onSubmitEditing={() => void form.submit()}
          />
          <FolderIconPicker value={form.icon} onChange={form.setIcon} onOpenChange={setIconOpen} disabled={form.busy} />
        </View>
        <PanelActions
          confirmLabel="Create folder"
          onConfirm={() => void form.submit()}
          onCancel={close}
          loading={form.busy}
        />
      </ThemedScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing[16] },
});
