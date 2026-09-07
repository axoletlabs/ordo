/**
 * Floating dialog to validate and save a new URL.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { UnlockForm } from "./LockPrompt";
import { CreateFolderPanel } from "./CreateFolderPanel";
import {
  SettingsSelect,
  type SettingsSelectOption,
} from "../settings/SettingsSelect";
import { useCreateBookmark } from "../../hooks/use-bookmarks";
import { useFolders } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { useTags } from "../../hooks/use-tags";
import { TagChip } from "../tags/TagChip";
import { TagSelectList } from "../tags/TagSelectList";
import { CreateTagPanel } from "../tags/CreateTagPanel";
import { errorMessage, isFolderProtected } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { prefetchExtraction } from "../../lib/prefetch-extraction";
import { toast } from "../ui/toast-store";
import { spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

export interface AddBookmarkSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Target folder, or null to save unfiled (root "Bookmarks"). */
  folderId: string | null;
  folderName?: string | null;
  allowFolderSelection?: boolean;
  initialUrl?: string;
  /** Tags preselected for the new bookmark (e.g. from a tag view). */
  initialTagIds?: string[];
}

const ROOT_DESTINATION = "__bookmarks__";
const NEW_FOLDER_DESTINATION = "__new_folder__";
/** Stable identity so the sheet's reset effect doesn't fire on parent renders. */
const NO_TAGS: string[] = [];

/** Display name for the save destination; unfiled bookmarks land in "Bookmarks". */
function destinationLabel(folderId: string | null, folderName?: string | null): string | null {
  if (folderName) return folderName;
  return folderId === null ? "Bookmarks" : null;
}

export function AddBookmarkSheet({
  visible,
  onDismiss,
  folderId,
  folderName,
  allowFolderSelection = false,
  initialUrl,
  initialTagIds = NO_TAGS,
}: AddBookmarkSheetProps) {
  const { palette } = useTheme();
  const create = useCreateBookmark();
  const { data: folders } = useFolders();
  const { data: tags } = useTags();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [lockedFolderId, setLockedFolderId] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialTagIds);
  const [selectedDestination, setSelectedDestination] = useState(folderId ?? ROOT_DESTINATION);
  const selectedFolderId = selectedDestination === ROOT_DESTINATION ? null : selectedDestination;
  const selectedFolder = folders?.find((folder) => folder.id === selectedFolderId);
  const destination = destinationLabel(
    selectedFolderId,
    allowFolderSelection ? selectedFolder?.name : folderName,
  );
  const destinationOptions: SettingsSelectOption<string>[] = [
    { value: ROOT_DESTINATION, label: "Bookmarks", icon: "bookmark-outline" },
    ...(folders ?? []).map((folder) => ({
      value: folder.id,
      label: folder.name,
      icon: folder.icon,
    })),
    { value: NEW_FOLDER_DESTINATION, label: "New folder", icon: "add" },
  ];

  const chooseDestination = (value: string) => {
    if (value === NEW_FOLDER_DESTINATION) {
      setCreateFolderOpen(true);
      return;
    }
    setSelectedDestination(value);
  };

  React.useEffect(() => {
    if (!visible) return;
    setSelectedDestination(folderId ?? ROOT_DESTINATION);
    setUrl(initialUrl ?? "");
    setError("");
    setLockedFolderId(null);
    setShowTagPicker(false);
    setSelectedTagIds(initialTagIds);
  }, [folderId, initialUrl, initialTagIds, visible]);

  React.useEffect(() => {
    if (!visible) return;
    const handle = setTimeout(() => prefetchExtraction(url), 400);
    return () => clearTimeout(handle);
  }, [url, visible]);

  const reset = () => {
    setUrl("");
    setError("");
    setLockedFolderId(null);
    setSelectedDestination(folderId ?? ROOT_DESTINATION);
    setShowTagPicker(false);
    setSelectedTagIds(initialTagIds);
  };

  const close = () => {
    reset();
    onDismiss();
  };

  const submit = async () => {
    if (create.isPending) return;
    setError("");
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter a URL.");
      return;
    }
    let normalized = trimmed;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    try {
      new URL(normalized);
    } catch {
      setError("Enter a valid URL.");
      return;
    }
    if (selectedFolderId && !useFolderTokenStore.getState().get(selectedFolderId)) {
      const dest = folders?.find((folder) => folder.id === selectedFolderId);
      if (dest?.protected) {
        setLockedFolderId(selectedFolderId);
        return;
      }
    }
    try {
      await create.mutateAsync({ url: normalized, folderId: selectedFolderId, tagIds: selectedTagIds });
      haptics.success();
      toast.success(destination ? `Saved to ${destination}` : "Saved");
      close();
    } catch (e) {
      if (selectedFolderId && isFolderProtected(e)) {
        setLockedFolderId(selectedFolderId);
        return;
      }
      haptics.error();
      setError(errorMessage(e));
    }
  };

  const lockedFolder = folders?.find((folder) => folder.id === lockedFolderId);

  const unlocking = Boolean(lockedFolderId);

  return (
    <>
      <FloatingPanel
        visible={visible}
        onDismiss={() => {
          if (unlocking) setLockedFolderId(null);
          else close();
        }}
      >
        {lockedFolderId ? (
          <UnlockForm
            folderId={lockedFolderId}
            folderName={lockedFolder?.name}
            lockType={lockedFolder?.lockType}
            pinLength={lockedFolder?.pinLength}
            autoPromptDevice
            onCancel={() => setLockedFolderId(null)}
            onUnlocked={() => {
              setLockedFolderId(null);
              void submit();
            }}
          />
        ) : (
          <>
            <PanelHeader title="Save bookmark" />
            {allowFolderSelection ? (
              <View style={styles.destinationRow}>
                <Text variant="label" color="tertiary">Destination</Text>
                <SettingsSelect
                  value={selectedDestination}
                  options={destinationOptions}
                  onChange={chooseDestination}
                  title="Save to"
                />
              </View>
            ) : destination ? (
              <Text variant="footnote" color="secondary" style={{ marginBottom: spacing[8] }}>
                Saving to <Text variant="footnote" color="accent">{destination}</Text>
              </Text>
            ) : null}

            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="Paste a link"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              error={error || undefined}
              icon={<Ionicons name="link-outline" size={18} color={palette.textTertiary} />}
              onSubmitEditing={() => void submit()}
              returnKeyType="done"
            />

            <View style={styles.tagsRow}>
              <Text variant="label" color="tertiary">Tags</Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={showTagPicker ? "Hide tag picker" : "Show tag picker"}
                onPress={() => setShowTagPicker((v) => !v)}
                hitSlop={8}
              >
                <Ionicons
                  name={showTagPicker ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={palette.textTertiary}
                />
              </PressableScale>
            </View>
            {selectedTagIds.length > 0 ? (
              <View style={styles.selectedTagWrap}>
                {selectedTagIds.map((tagId) => {
                  const tag = tags?.find((t) => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <TagChip
                      key={tagId}
                      name={tag.name}
                      color={tag.color}
                      selected
                      compact
                      onPress={() =>
                        setSelectedTagIds((prev) => prev.filter((id) => id !== tagId))
                      }
                      accessibilityLabel={`Remove tag ${tag.name}`}
                    />
                  );
                })}
              </View>
            ) : null}
            {showTagPicker ? (
              <TagSelectList
                selectedIds={selectedTagIds}
                onToggle={(tagId) =>
                  setSelectedTagIds((prev) =>
                    prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
                  )
                }
                maxHeight={200}
                onRequestCreateTag={() => setCreateTagOpen(true)}
              />
            ) : null}

            <View style={styles.actions}>
              <Button label="Cancel" variant="secondary" onPress={close} style={styles.action} />
              <Button label="Save" onPress={submit} loading={create.isPending} style={styles.saveAction} />
            </View>
          </>
        )}
      </FloatingPanel>
      <CreateFolderPanel
        visible={createFolderOpen}
        onDismiss={() => setCreateFolderOpen(false)}
        onCreated={(folder) => setSelectedDestination(folder.id)}
      />
      {/* Sibling of the save sheet: nested modals are not supported on Android. */}
      <CreateTagPanel
        visible={createTagOpen}
        onDismiss={() => setCreateTagOpen(false)}
        onCreated={(tag) => setSelectedTagIds((prev) => [...prev, tag.id])}
      />
    </>
  );
}

const styles = StyleSheet.create({
  destinationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[12],
    marginBottom: spacing[8],
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing[10],
    marginBottom: spacing[4],
  },
  selectedTagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[6],
    marginBottom: spacing[6],
  },
  actions: {
    flexDirection: "row",
    gap: spacing[8],
    marginTop: spacing[12],
  },
  action: { flex: 1 },
  saveAction: { flex: 1.4 },
});
