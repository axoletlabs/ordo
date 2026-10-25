/**
 * Floating dialog to validate and save a new URL.
 */
import React, { useState } from "react";
import { Platform, StyleSheet, View, type TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { FloatingPanel } from "../ui/FloatingPanel";
import { AnimatedSwap } from "../ui/AnimatedSwap";
import { AnimatedDisclosure } from "../ui/AnimatedDisclosure";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { IconButton } from "../ui/IconButton";
import { extractSharedUrl } from "../../lib/shared-url";
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
import { focusTextInput } from "../../lib/focus-text-input";
import { isSupportedUrl } from "@ordo/shared";
import { LazyMount } from "../ui/LazyMount";
import { useOpeningFocus } from "./use-opening-focus";

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

/** The single surface that owns focus/Back for the save flow. */
type Surface = "closed" | "form" | "folderPicker" | "tagPicker" | "createFolder" | "createTag" | "unlock";

/** Display name for the save destination; unfiled bookmarks land in "Bookmarks". */
function destinationLabel(folderId: string | null, folderName?: string | null): string | null {
  if (folderName) return folderName;
  return folderId === null ? "Bookmarks" : null;
}

export function AddBookmarkSheet(props: AddBookmarkSheetProps) {
  return <LazyMount active={props.visible}>{() => <AddBookmarkContent {...props} />}</LazyMount>;
}

function AddBookmarkContent({
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
  const urlRef = React.useRef<TextInput>(null);
  const tagSearchRef = React.useRef<TextInput>(null);
  const tagMenuRef = React.useRef<View>(null);
  const pasteEpoch = React.useRef(0);
  /** Bumped by any user/external URL edit; a pending clipboard read from an
   * older revision must never overwrite newer text (or refocus it). */
  const draftRevision = React.useRef(0);
  const active = React.useRef(visible);
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

  // Exactly one surface owns focus/Back. Deriving it from `visible` means a
  // parent close releases every child selector in the same commit, before the
  // passive reset can run.
  const surface: Surface = !visible ? "closed"
    : lockedFolderId ? "unlock"
    : createFolderOpen ? "createFolder"
    : createTagOpen ? "createTag"
    : destinationOpen ? "folderPicker"
    : showTagPicker ? "tagPicker"
    : "form";
  const surfaceRef = React.useRef<Surface>(surface);
  const folderPickerOpen = surface === "folderPicker";
  const tagPickerOpen = surface === "tagPicker";
  const panelObscured = surface === "createFolder" || surface === "createTag";
  const panelInteractive = surface === "form" || surface === "unlock";
  // Stable content key: callers may pass a fresh same-value array (or the same
  // set in another order) on every render, which is not a new intent and must
  // not reset an active draft.
  const tagKey = [...new Set(initialTagIds)].sort().join("\u0000");
  const appliedProps = React.useRef({ visible: false, folderId, initialUrl, tagKey });
  // One applied open/intake session. Render-adjusted state, not a mutable
  // ref: a discarded concurrent render must not invent a close/new URL and
  // then silently suppress or mis-focus a save that belongs to the live
  // session. Stable across clipboard requests and child pickers; closing or
  // a different intake URL starts a new token. The committed token is
  // published before paint below, so real closes invalidate in-flight saves.
  const [session, setSession] = React.useState(() => ({ visible, initialUrl, token: visible ? 1 : 0 }));
  if (session.visible !== visible) {
    setSession({ visible, initialUrl, token: session.token + 1 });
  } else if (visible && session.initialUrl !== initialUrl) {
    setSession({ visible, initialUrl, token: session.token + 1 });
  }
  const committedSession = React.useRef(session.token);

  // Live ownership is also committed-state: an aborted render may not retarget
  // clipboard focus or suppress settlement before React actually publishes it.
  React.useLayoutEffect(() => {
    active.current = visible;
    surfaceRef.current = surface;
    committedSession.current = session.token;
  }, [session.token, surface, visible]);

  // A route change can unmount a still-visible sheet, so the committed token
  // never changes. Invalidate async UI settlement and clipboard work for this
  // mount. StrictMode replays setup/cleanup during development; the ownership
  // layout effect above re-publishes the live `active` value on the replay.
  React.useLayoutEffect(() => () => {
    active.current = false;
    pasteEpoch.current += 1;
    draftRevision.current += 1;
  }, []);

  /** A Save-owned child callback may only act for the child surface that was
   * rendered in the same applied session. The token is captured by this render
   * closure, so a stale await from a closed/reopened session cannot attach its
   * folder/tag to the new draft or dismiss the new child. */
  const ownsChild = (expected: Surface) => active.current
    && surfaceRef.current === expected
    && session.token === committedSession.current;

  // Native tag pickers delegate opening focus to the shared Input scope (the
  // ContextMenu's measured active/ready session). Web keeps the explicit,
  // cancellable take and never relies on native mount autofocus.
  const tagOpeningFocus = useOpeningFocus({
    active: Platform.OS === "web" && tagPickerOpen,
    targetRef: tagSearchRef,
    scopeRef: tagMenuRef,
  });

  // Owner close: release every child surface and pending clipboard work before
  // paint. Waiting for the passive reset left a selector active for one commit.
  React.useLayoutEffect(() => {
    if (visible) return;
    // Mark the session closed before paint so a synchronous reopen cannot
    // mistake a stale `true` for "still open".
    appliedProps.current.visible = false;
    pasteEpoch.current += 1;
    draftRevision.current += 1;
    setCreateFolderOpen(false);
    setDestinationOpen(false);
    setCreateTagOpen(false);
    setLockedFolderId(null);
    setShowTagPicker(false);
    setUrlEditing(false);
  }, [visible]);

  // Opening resets the draft from the props of that session. While the sheet
  // stays open, a genuinely different prop value is new intent for that field
  // only; a same-value initialTagIds array is not a reset signal.
  React.useEffect(() => {
    const applied = appliedProps.current;
    if (!visible) {
      applied.visible = false;
      return;
    }
    if (!applied.visible) {
      appliedProps.current = { visible: true, folderId, initialUrl, tagKey };
      setSelectedDestination(folderId ?? ROOT_DESTINATION);
      setUrl(initialUrl ?? "");
      setError("");
      setLockedFolderId(null);
      setShowTagPicker(false);
      setUrlEditing(false);
      setSelectedTagIds(initialTagIds);
      return;
    }
    if (applied.folderId !== folderId) {
      applied.folderId = folderId;
      setSelectedDestination(folderId ?? ROOT_DESTINATION);
    }
    if (applied.initialUrl !== initialUrl) {
      applied.initialUrl = initialUrl;
      // A different intake URL is a new drafted link even without a close:
      // an in-flight save for the previous link must not settle into it.
      draftRevision.current += 1;
      setUrl(initialUrl ?? "");
      setError("");
      setUrlEditing(false);
    }
    if (applied.tagKey !== tagKey) {
      applied.tagKey = tagKey;
      setSelectedTagIds([...initialTagIds]);
    }
  }, [folderId, initialTagIds, initialUrl, tagKey, visible]);

  React.useEffect(() => {
    if (!visible) return;
    const handle = setTimeout(() => prefetchExtraction(url), 400);
    return () => clearTimeout(handle);
  }, [url, visible]);

  /** Dropdowns own the surface: release the link field's focus before the
   * picker opens so a suspended panel never keeps the caret or the IME. On
   * native the field's last-focus record survives, so an outside-tap close
   * returns the keyboard to Link rather than the library search behind it. */
  const handFocusToDropdown = () => {
    urlRef.current?.blur();
  };

  const reset = () => {
    pasteEpoch.current += 1;
    draftRevision.current += 1;
    setUrl("");
    setError("");
    setLockedFolderId(null);
    setSelectedDestination(folderId ?? ROOT_DESTINATION);
    setDestinationOpen(false);
    setShowTagPicker(false);
    setCreateFolderOpen(false);
    setCreateTagOpen(false);
    setUrlEditing(false);
    setSelectedTagIds(initialTagIds);
  };

  const close = () => {
    // FloatingPanel retains the draft through its exit transition.
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
    const session = committedSession.current;
    try {
      await create.mutateAsync({ url: normalized, folderId: selectedFolderId, tagIds: selectedTagIds });
      // The request may settle after the user closed/reopened or supplied a
      // new intake URL. Its cache write stands, but only the session that
      // started it may dismiss, reset, report, or focus the UI. Compare the
      // committed token: a discarded render never reached layout publication.
      // An unmount keeps the token but clears `active`, so route changes are
      // covered too.
      if (session !== committedSession.current || !active.current) return;
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
      if (session !== committedSession.current || !active.current) return;
      if (selectedFolderId && isFolderProtected(e)) {
        setLockedFolderId(selectedFolderId);
        return;
      }
      haptics.error();
      setError(errorMessage(e));
    }
  };

  const lockedFolder = folders?.find((folder) => folder.id === lockedFolderId);

  const pasteLink = async () => {
    const epoch = ++pasteEpoch.current;
    const revision = draftRevision.current;
    try {
      const clipboard = await Clipboard.getStringAsync();
      if (!active.current || epoch !== pasteEpoch.current || revision !== draftRevision.current) return;
      const next = extractSharedUrl(undefined, clipboard) ?? clipboard.trim();
      if (!next) { setError("Clipboard is empty. Copy a link first."); return; }
      setUrl(next);
      setError("");
      requestAnimationFrame(() => {
        if (!active.current || epoch !== pasteEpoch.current || revision !== draftRevision.current) return;
        // Keep the clipboard draft when a picker/create/unlock surface opened
        // meanwhile, but never pull focus or the IME back to the background.
        if (surfaceRef.current !== "form") return;
        // Paste is explicit user intent for this field, so reopening the IME
        // here is appropriate. The helper only resets this same field on the
        // Android Back-hid-the-IME edge; it never blurs another surface.
        focusTextInput(urlRef.current);
      });
    } catch {
      if (active.current && epoch === pasteEpoch.current && revision === draftRevision.current) {
        setError("Clipboard access is blocked. Paste the link manually.");
      }
    }
  };

  const unlocking = Boolean(lockedFolderId);
  const showUrlPreview = shareIntake && !urlEditing && Boolean(url.trim());

  return (
    <>
      <FloatingPanel
        visible={visible}
        pageKey={lockedFolderId ? "unlock" : "save"}
        obscured={panelObscured}
        interactive={panelInteractive}
        dismissible={!create.isPending}
        dismissOnScrim={!shareIntake}
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
            onCancel={() => { if (ownsChild("unlock")) setLockedFolderId(null); }}
            onUnlocked={() => {
              if (!ownsChild("unlock")) return;
              setLockedFolderId(null);
              void submit();
            }}
          />
        ) : (
          <>
            <PanelHeader title="Save bookmark" onClose={!shareIntake && !create.isPending ? close : undefined} />
            <View style={styles.body}>
            <AnimatedSwap transitionKey={showUrlPreview ? "preview" : "edit"}>
            {showUrlPreview ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Edit link"
                disabled={create.isPending}
                onPress={() => setUrlEditing(true)}
                style={[
                  styles.urlPreview,
                  {
                    borderColor: error ? palette.error : palette.outlineVariant,
                    backgroundColor: palette.surfaceContainerHighest,
                  },
                ]}
              >
                <Ionicons name="link-outline" size={18} color={palette.textTertiary} style={iconGlyphStyle(18)} />
                <View style={styles.urlPreviewText}>
                  <Text variant="titleMedium" numberOfLines={1}>
                    {domainFromUrl(url) || url}
                  </Text>
                  <Text variant="bodySmall" color="secondary" numberOfLines={2}>
                    {url}
                  </Text>
                </View>
                <Ionicons name="pencil-outline" size={16} color={palette.textTertiary} style={iconGlyphStyle(16)} />
              </PressableScale>
            ) : (
              <Input
                ref={urlRef}
                label="Link"
                disabled={create.isPending}
                variant="outlined"
                value={url}
                onChangeText={(next) => { draftRevision.current += 1; setUrl(next); if (error) setError(""); }}
                placeholder="Paste a link"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={visible && (!shareIntake || urlEditing)}
                error={error || undefined}
                icon={<Ionicons name="link-outline" size={18} color={palette.textTertiary} style={iconGlyphStyle(18)} />}
                onSubmitEditing={() => void submit()}
                returnKeyType="done"
                overlayRightAccessory overlayPaddingRight={56}
                rightAccessory={<IconButton name="clipboard-outline" variant="standard" accessibilityLabel="Paste link from clipboard" onPress={() => void pasteLink()} />}
              />
            )}
            </AnimatedSwap>
            <AnimatedDisclosure expanded={Boolean(showUrlPreview && error)}>
              <Text variant="footnote" color="danger" style={styles.urlPreviewError}>
                {error}
              </Text>
            </AnimatedDisclosure>

            {allowFolderSelection ? <PickerField label="Folder" value={destination ?? "Bookmarks"} dropdown expanded={destinationOpen} disabled={create.isPending}
              icon={selectedFolder?.icon ?? "bookmark-outline"} onPress={(anchor) => { handFocusToDropdown(); setDestinationAnchor(anchor); setDestinationOpen(true); }} />
              : destination ? <Text variant="bodyMedium" color="secondary">Saving to {destination}</Text> : null}
            <PickerField label="Tags" icon="pricetags-outline" dropdown expanded={showTagPicker} disabled={create.isPending}
              value={selectedTagIds.length ? selectedTagIds.map((id) => tags?.find((tag) => tag.id === id)?.name).filter(Boolean).join(", ") || `${selectedTagIds.length} tags selected` : "Add tags"}
              onPress={(anchor) => { handFocusToDropdown(); setTagAnchor(anchor); setShowTagPicker(true); }} />
            </View>
            <PanelActions
              confirmLabel="Save bookmark"
              onConfirm={() => void submit()}
              onCancel={close}
              loading={create.isPending}
            />
          </>
        )}
      </FloatingPanel>
      <FolderPickerMenu visible={folderPickerOpen} onDismiss={() => setDestinationOpen(false)} folders={folders ?? []} anchor={destinationAnchor} returnFocusRef={urlRef}
        value={selectedFolderId} onChange={(id) => setSelectedDestination(id ?? ROOT_DESTINATION)}
        onCreate={() => { setDestinationOpen(false); setCreateFolderOpen(true); }} />
      <ContextMenu visible={tagPickerOpen} onDismiss={() => setShowTagPicker(false)} anchor={tagAnchor} width={tagAnchor?.width} scrollBody={false} keyboardDismiss={false} estimatedHeight={280} returnFocusRef={urlRef}>
        <View ref={tagMenuRef} {...tagOpeningFocus} style={{ paddingHorizontal: spacing[16], flexShrink: 1 }}>
        <TagSelectList selectedIds={selectedTagIds} searchInputRef={tagSearchRef}
          searchAutoFocus={Platform.OS !== "web"}
          onToggle={(tagId) => setSelectedTagIds((previous) => previous.includes(tagId) ? previous.filter((id) => id !== tagId) : [...previous, tagId])}
          menu maxHeight={240} onRequestCreateTag={() => { setShowTagPicker(false); setCreateTagOpen(true); }} />
        </View>
      </ContextMenu>
      <CreateFolderPanel
        visible={surface === "createFolder"}
        onDismiss={() => { if (ownsChild("createFolder")) setCreateFolderOpen(false); }}
        onCreated={(folder) => { if (ownsChild("createFolder")) setSelectedDestination(folder.id); }}
      />
      {/* Sibling of the save sheet: nested modals are not supported on Android. */}
      <CreateTagPanel
        visible={surface === "createTag"}
        onDismiss={() => { if (ownsChild("createTag")) setCreateTagOpen(false); }}
        onCreated={(tag) => {
          if (!ownsChild("createTag")) return;
          setSelectedTagIds((prev) => [...prev, tag.id]);
        }}
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
    minHeight: 72,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[16],
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  urlPreviewText: { flex: 1, minWidth: 0, gap: spacing[2] },
  urlPreviewError: { marginTop: spacing[6] },
});
