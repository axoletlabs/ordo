/**
 * Floating dialog to validate and save a new URL.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { PickerField } from "../ui/PickerField";
import { FolderPickerMenu } from "./FolderPickerMenu";
import { ContextMenu, type MenuAnchorRect } from "../ui/ContextMenu";
import { PanelActions } from "../ui/SheetActionRow";
import { UnlockForm } from "./LockPrompt";
import { CreateFolderPanel } from "./CreateFolderPanel";
import { useCreateBookmark } from "../../hooks/use-bookmarks";
import { useFolders } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { useTags } from "../../hooks/use-tags";
import { TagSelectList } from "../tags/TagSelectList";
import { CreateTagPanel } from "../tags/CreateTagPanel";
import { errorMessage, isFolderProtected } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { prefetchExtraction } from "../../lib/prefetch-extraction";
import { toast } from "../ui/toast-store";
import { spacing, radius } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { domainFromUrl } from "../../lib/format";
import { isSupportedUrl } from "@ordo/shared";

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
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [destinationAnchor, setDestinationAnchor] = useState<MenuAnchorRect | null>(null);
  const [tagAnchor, setTagAnchor] = useState<MenuAnchorRect | null>(null);
  const [urlEditing, setUrlEditing] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialTagIds);
  const [selectedDestination, setSelectedDestination] = useState(folderId ?? ROOT_DESTINATION);
  const selectedFolderId = selectedDestination === ROOT_DESTINATION ? null : selectedDestination;
  const selectedFolder = folders?.find((folder) => folder.id === selectedFolderId);
  const destination = destinationLabel(
    selectedFolderId,
    allowFolderSelection ? selectedFolder?.name : folderName,
  );

  React.useEffect(() => {
    if (!visible) {
      setCreateFolderOpen(false);
      setDestinationOpen(false);
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
    if (!isSupportedUrl(normalized)) {
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
        obscured={createFolderOpen || createTagOpen}
        interactive={!destinationOpen && !showTagPicker}
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
                <Ionicons name="link-outline" size={18} color={palette.textTertiary} style={iconGlyphStyle(18)} />
                <View style={styles.urlPreviewText}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {domainFromUrl(url) || url}
                  </Text>
                  <Text variant="monoSmall" color="tertiary" numberOfLines={1}>
                    {url}
                  </Text>
                </View>
                <Ionicons name="pencil-outline" size={16} color={palette.textTertiary} style={iconGlyphStyle(16)} />
              </PressableScale>
            ) : (
              <Input
                label="Link"
                value={url}
                onChangeText={setUrl}
                placeholder="Paste a link"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={!shareIntake || urlEditing}
                error={error || undefined}
                icon={<Ionicons name="link-outline" size={18} color={palette.textTertiary} style={iconGlyphStyle(18)} />}
                onSubmitEditing={() => void submit()}
                returnKeyType="done"
              />
            )}
            {showUrlPreview && error ? (
              <Text variant="footnote" color="danger" style={styles.urlPreviewError}>
                {error}
              </Text>
            ) : null}

            {allowFolderSelection ? <PickerField label="Folder" value={destination ?? "Bookmarks"} dropdown expanded={destinationOpen}
              icon={selectedFolder?.icon ?? "bookmark-outline"} onPress={(anchor) => { setDestinationAnchor(anchor); setDestinationOpen(true); }} />
              : destination ? <Text variant="bodyMedium" color="secondary">Saving to {destination}</Text> : null}
            <PickerField label="Tags" icon="pricetags-outline" dropdown expanded={showTagPicker}
              value={selectedTagIds.length ? selectedTagIds.map((id) => tags?.find((tag) => tag.id === id)?.name).filter(Boolean).join(", ") || `${selectedTagIds.length} tags selected` : "Add tags"}
              onPress={(anchor) => { setTagAnchor(anchor); setShowTagPicker(true); }} />
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
      <FolderPickerMenu visible={destinationOpen} onDismiss={() => setDestinationOpen(false)} folders={folders ?? []} anchor={destinationAnchor}
        value={selectedFolderId} onChange={(id) => setSelectedDestination(id ?? ROOT_DESTINATION)}
        onCreate={() => { setDestinationOpen(false); setCreateFolderOpen(true); }} />
      <ContextMenu visible={showTagPicker && !createTagOpen} onDismiss={() => setShowTagPicker(false)} anchor={tagAnchor} width={tagAnchor?.width} scrollBody={false} keyboardDismiss={false} estimatedHeight={280}>
        <View style={{ paddingHorizontal: spacing[8], flexShrink: 1 }}>
        <TagSelectList selectedIds={selectedTagIds}
          onToggle={(tagId) => setSelectedTagIds((previous) => previous.includes(tagId) ? previous.filter((id) => id !== tagId) : [...previous, tagId])}
          menu maxHeight={240} onRequestCreateTag={() => { setShowTagPicker(false); setCreateTagOpen(true); }} />
        </View>
      </ContextMenu>
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
  body: { gap: spacing[16] },
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
});
