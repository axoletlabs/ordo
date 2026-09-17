/**
 * Floating dialog to validate and save a new URL.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { PanelActions } from "../ui/SheetActionRow";
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
import { spacing, radius } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { domainFromUrl } from "../../lib/format";

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
  /**
   * Share-sheet intake: URL is already known, so don't autofocus the keyboard,
   * don't dismiss on a scrim tap (that returns to the sender on Android), and
   * show the link as a confirmed preview until the user edits it.
   */
  shareIntake?: boolean;
  /** Share intake only: called instead of `onDismiss` after a successful save. */
  onSaved?: (destinationLabel: string | null) => void;
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
  shareIntake = false,
  onSaved,
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
  const [urlEditing, setUrlEditing] = useState(false);
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
    if (!visible) {
      setCreateFolderOpen(false);
      setCreateTagOpen(false);
      setLockedFolderId(null);
      setShowTagPicker(false);
      setUrlEditing(false);
      return;
    }
    setSelectedDestination(folderId ?? ROOT_DESTINATION);
    setUrl(initialUrl ?? "");
    setError("");
    setLockedFolderId(null);
    setShowTagPicker(false);
    setUrlEditing(false);
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
    setUrlEditing(false);
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
      if (shareIntake) setUrlEditing(true);
      return;
    }
    let normalized = trimmed;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    try {
      new URL(normalized);
    } catch {
      setError("Enter a valid URL.");
      if (shareIntake) setUrlEditing(true);
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
      if (shareIntake) {
        reset();
        onSaved?.(destination);
        if (!onSaved) onDismiss();
        return;
      }
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
  const showUrlPreview = shareIntake && !urlEditing && Boolean(url.trim());

  return (
    <>
      <FloatingPanel
        visible={visible}
        dismissible={!shareIntake}
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
            <View style={styles.body}>
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

            {showUrlPreview ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Edit link"
                onPress={() => setUrlEditing(true)}
                style={[
                  styles.urlPreview,
                  {
                    borderColor: error ? palette.danger : palette.border,
                    backgroundColor: palette.background,
                  },
                ]}
              >
                <Ionicons name="link-outline" size={18} color={palette.textTertiary} />
                <View style={styles.urlPreviewText}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {domainFromUrl(url) || url}
                  </Text>
                  <Text variant="monoSmall" color="tertiary" numberOfLines={1}>
                    {url}
                  </Text>
                </View>
                <Ionicons name="pencil-outline" size={16} color={palette.textTertiary} />
              </PressableScale>
            ) : (
              <Input
                value={url}
                onChangeText={setUrl}
                placeholder="Paste a link"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={!shareIntake || urlEditing}
                error={error || undefined}
                icon={<Ionicons name="link-outline" size={18} color={palette.textTertiary} />}
                onSubmitEditing={() => void submit()}
                returnKeyType="done"
              />
            )}
            {showUrlPreview && error ? (
              <Text variant="footnote" color="danger" style={styles.urlPreviewError}>
                {error}
              </Text>
            ) : null}

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
            </View>
            <PanelActions
              confirmLabel="Save"
              onConfirm={() => void submit()}
              onCancel={close}
              loading={create.isPending}
            />
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
  body: {},
  destinationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[12],
    marginBottom: spacing[8],
  },
  urlPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    minHeight: 46,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  urlPreviewText: { flex: 1, minWidth: 0, gap: spacing[2] },
  urlPreviewError: { marginTop: spacing[6] },
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
});
