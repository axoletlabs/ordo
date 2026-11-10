/**
 * Floating dialog to collect, validate, and save one or more links.
 */
import React, { useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { ResponsivePicker } from "../ui/ResponsivePicker";
import { FloatingPanel } from "../ui/FloatingPanel";
import { AnimatedDisclosure } from "../ui/AnimatedDisclosure";
import { PanelHeader } from "../ui/PanelHeader";
import { Button } from "../ui/Button";
import { extractSharedUrls } from "../../lib/shared-url";
import { Text } from "../ui/Text";
import { PickerField } from "../ui/PickerField";
import { FolderPickerMenu } from "./FolderPickerMenu";
import type { MenuAnchorRect } from "../ui/ContextMenu";
import { PanelActions } from "../ui/SheetActionRow";
import { UnlockForm } from "./LockPrompt";
import { CreateFolderPanel } from "./CreateFolderPanel";
import { useCreateBookmark } from "../../hooks/use-bookmarks";
import { useFolders } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { useSettingsStore } from "../../store/settings";
import { useTags } from "../../hooks/use-tags";
import { TagSelectList } from "../tags/TagSelectList";
import { CreateTagPanel } from "../tags/CreateTagPanel";
import { errorMessage, isFolderProtected } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { prefetchExtraction } from "../../lib/prefetch-extraction";
import { toast } from "../ui/toast-store";
import { spacing } from "../../theme/tokens";
import { bookmarkDraftsFromUrls, pasteBookmarkDrafts, normalizeBookmarkDraft, validateBookmarkDrafts, type BookmarkDraft } from "../../lib/bookmark-drafts";
import { BookmarkLinkField, BookmarkLinkLayout, useBookmarkLinkActions } from "./BookmarkLinkField";
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
  initialUrls?: readonly string[];
  /** Tags preselected for the new bookmark (e.g. from a tag view). */
  initialTagIds?: string[];
  /**
   * Share-sheet intake: links are already known, so don't autofocus the keyboard,
   * don't dismiss on a scrim tap (that returns to the sender on Android), and
   * keep the links compact until the user edits one.
   */
  shareIntake?: boolean;
  /** Share intake only: called instead of `onDismiss` after a successful save. */
  onSaved?: (destinationLabel: string | null, count: number) => void;
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
  initialUrls,
  initialTagIds = NO_TAGS,
  shareIntake = false,
  onSaved,
}: AddBookmarkSheetProps) {
  const { width } = useWindowDimensions();
  const intakeKey = JSON.stringify(initialUrls ?? (initialUrl ? [initialUrl] : []));
  const intakeUrls = React.useMemo(() => JSON.parse(intakeKey) as string[], [intakeKey]);
  const hasIntake = intakeUrls.length > 0;
  const create = useCreateBookmark();
  const { data: folders } = useFolders();
  const { data: tags } = useTags();
  const [links, setLinks] = useState<BookmarkDraft[]>(() => bookmarkDraftsFromUrls(intakeUrls));
  const nextLinkId = React.useRef(Math.max(1, intakeUrls.length));
  const [activeLinkId, setActiveLinkId] = useState<number | null>(shareIntake && hasIntake ? null : 0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const saveRun = React.useRef<object | null>(null);
  const entranceReady = React.useRef(false);
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
  const panelObscured = surface === "createFolder" || surface === "createTag" || width < 600 && (surface === "folderPicker" || surface === "tagPicker");
  const panelInteractive = surface === "form" || surface === "unlock";
  // Stable content key: callers may pass a fresh same-value array (or the same
  // set in another order) on every render, which is not a new intent and must
  // not reset an active draft.
  const tagKey = [...new Set(initialTagIds)].sort().join("\u0000");
  const appliedProps = React.useRef({ visible: false, folderId, intakeKey, tagKey });
  // One applied open/intake session. Render-adjusted state, not a mutable
  // ref: a discarded concurrent render must not invent a close/new URL and
  // then silently suppress or mis-focus a save that belongs to the live
  // session. Stable across clipboard requests and child pickers; closing or
  // a different intake URL starts a new token. The committed token is
  // published before paint below, so real closes invalidate in-flight saves.
  const [session, setSession] = React.useState(() => ({ visible, intakeKey, token: visible ? 1 : 0 }));
  if (session.visible !== visible) {
    setSession({ visible, intakeKey, token: session.token + 1 });
  } else if (visible && session.intakeKey !== intakeKey) {
    setSession({ visible, intakeKey, token: session.token + 1 });
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
    entranceReady.current = false;
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
      appliedProps.current = { visible: true, folderId, intakeKey, tagKey };
      setSelectedDestination(folderId ?? ROOT_DESTINATION);
      setLinks(bookmarkDraftsFromUrls(intakeUrls));
      nextLinkId.current = Math.max(1, intakeUrls.length);
      setActiveLinkId(shareIntake && hasIntake ? null : 0);
      setFocusRequest(0);
      saveRun.current = null;
      setSaving(false);
      setError("");
      setLockedFolderId(null);
      setShowTagPicker(false);
      setSelectedTagIds(initialTagIds);
      return;
    }
    if (applied.folderId !== folderId) {
      applied.folderId = folderId;
      setSelectedDestination(folderId ?? ROOT_DESTINATION);
    }
    if (applied.intakeKey !== intakeKey) {
      applied.intakeKey = intakeKey;
      // A different intake URL is a new drafted link even without a close:
      // an in-flight save for the previous link must not settle into it.
      draftRevision.current += 1;
      setLinks(bookmarkDraftsFromUrls(intakeUrls));
      nextLinkId.current = Math.max(1, intakeUrls.length);
      setActiveLinkId(shareIntake && hasIntake ? null : 0);
      setFocusRequest(0);
      saveRun.current = null;
      setSaving(false);
      setError("");
    }
    if (applied.tagKey !== tagKey) {
      applied.tagKey = tagKey;
      setSelectedTagIds([...initialTagIds]);
    }
  }, [folderId, initialTagIds, intakeKey, intakeUrls, hasIntake, shareIntake, tagKey, visible]);

  // (Beta) Clipboard auto-paste: with the setting on, an opening draft with
  // no link yet pulls every URL from the clipboard — even from inside
  // surrounding text. Silent and best effort: blocked reads, empty boards,
  // or text without a link just leave the field untouched. Declared after
  // the reset above so a resolved read lands on the freshly cleared draft;
  // the revision guard keeps it from ever overwriting typed text.
  React.useEffect(() => {
    if (!visible || shareIntake || hasIntake) return;
    if (!useSettingsStore.getState().autoPasteClipboardLink) return;
    const epoch = ++pasteEpoch.current;
    const revision = draftRevision.current;
    void (async () => {
      try {
        // Probe without reading first so an empty clipboard never triggers
        // the iOS paste notice; if the probe is unavailable, read anyway.
        if (!(await Clipboard.hasStringAsync().catch(() => true))) return;
        const clipboard = await Clipboard.getStringAsync();
        if (!active.current || epoch !== pasteEpoch.current || revision !== draftRevision.current) return;
        const urls = extractSharedUrls(undefined, clipboard);
        if (!urls.length) return;
        setLinks(bookmarkDraftsFromUrls(urls));
        nextLinkId.current = Math.max(1, urls.length);
        setError("");
      } catch {
        // The user didn't ask for this read, so never surface its errors.
      }
    })();
  }, [intakeKey, hasIntake, shareIntake, visible]);

  React.useEffect(() => {
    if (!visible) return;
    const link = links.find((draft) => draft.id === activeLinkId);
    if (!link) return;
    const handle = setTimeout(() => prefetchExtraction(link.url), 400);
    return () => clearTimeout(handle);
  }, [activeLinkId, links, visible]);

  /** Dropdowns own the surface: hand the link row to the picker. On native
   * the picker's search field moves focus (and the IME target) in one step
   * through the scoped focus take, so an eager blur here would only start an
   * IME hide its reopen has to fight. Web restores focus through its own
   * overlay machinery and expects the field released before the picker opens. */
  const handFocusToDropdown = () => {
    if (Platform.OS === "web") urlRef.current?.blur();
    setActiveLinkId(null);
  };

  const reset = () => {
    pasteEpoch.current += 1;
    draftRevision.current += 1;
    setLinks([{ id: 0, url: "" }]);
    setActiveLinkId(0);
    setFocusRequest(0);
    setError("");
    setLockedFolderId(null);
    setSelectedDestination(folderId ?? ROOT_DESTINATION);
    setDestinationOpen(false);
    setShowTagPicker(false);
    setCreateFolderOpen(false);
    setCreateTagOpen(false);
    setSelectedTagIds(initialTagIds);
  };

  const close = () => {
    // FloatingPanel retains the draft through its exit transition.
    onDismiss();
  };

  const editLink = (id: number, input: TextInput | null = null) => {
    if (saving || saveRun.current) return;
    if (input) urlRef.current = input;
    setActiveLinkId(id);
    if (!input) {
      pasteEpoch.current += 1;
      setFocusRequest((value) => value + 1);
    }
  };

  const addLink = () => {
    if (saving) return;
    draftRevision.current += 1;
    const empty = links.find((link) => !link.url.trim());
    const id = empty?.id ?? nextLinkId.current++;
    if (!empty) setLinks((previous) => [...previous, { id, url: "" }]);
    editLink(id);
  };

  const removeLink = (id: number) => {
    if (saving || links.length === 1) return;
    draftRevision.current += 1;
    setLinks((previous) => previous.filter((link) => link.id !== id));
    if (activeLinkId === id) {
      const index = links.findIndex((link) => link.id === id);
      editLink(links[index + 1]?.id ?? links[index - 1].id);
    }
    setError("");
  };

  const submit = async () => {
    if (saveRun.current) return;
    pasteEpoch.current += 1;
    setError("");
    const checked = validateBookmarkDrafts(links);
    setLinks(checked);
    const invalid = checked.find((draft) => draft.error);
    if (invalid) {
      editLink(invalid.id);
      return;
    }
    const pending = checked.filter((draft) => draft.url.trim());
    if (selectedFolderId && !useFolderTokenStore.getState().get(selectedFolderId)) {
      const dest = folders?.find((folder) => folder.id === selectedFolderId);
      if (dest?.protected) {
        setLockedFolderId(selectedFolderId);
        return;
      }
    }
    const owner = committedSession.current;
    const run = {};
    saveRun.current = run;
    setSaving(true);
    setSaveProgress(0);
    const saved = new Set<number>();
    const ownsRun = () => owner === committedSession.current && active.current && saveRun.current === run;
    try {
      // Reuse the canonical create mutation so every successful item updates
      // the library, folder counts, tags, and extraction queue immediately.
      for (const draft of pending) {
        if (!ownsRun()) return;
        await create.mutateAsync({ url: normalizeBookmarkDraft(draft.url), folderId: selectedFolderId, tagIds: selectedTagIds });
        saved.add(draft.id);
        if (!ownsRun()) return;
        setSaveProgress(saved.size);
      }
      haptics.success();
      if (shareIntake) {
        reset();
        onSaved?.(destination, pending.length);
        if (!onSaved) onDismiss();
        return;
      }
      const label = pending.length === 1 ? "Bookmark" : `${pending.length} bookmarks`;
      toast.success(destination ? `${label} saved to ${destination}` : `${label} saved`);
      close();
    } catch (e) {
      if (!ownsRun()) return;
      // A retry must never resubmit links that already succeeded.
      if (saved.size) {
        setLinks((previous) => previous.filter((draft) => !saved.has(draft.id)));
        setActiveLinkId(null);
      }
      if (selectedFolderId && isFolderProtected(e)) {
        setLockedFolderId(selectedFolderId);
        return;
      }
      haptics.error();
      setError(saved.size ? `${saved.size} saved. Remaining links are kept here. ${errorMessage(e)}` : errorMessage(e));
    } finally {
      if (saveRun.current === run) {
        saveRun.current = null;
        setSaving(false);
      }
    }
  };

  const lockedFolder = folders?.find((folder) => folder.id === lockedFolderId);

  const pasteLink = async (id: number) => {
    if (saving || saveRun.current) return;
    const epoch = ++pasteEpoch.current;
    const revision = draftRevision.current;
    try {
      const clipboard = await Clipboard.getStringAsync();
      if (!active.current || epoch !== pasteEpoch.current || revision !== draftRevision.current) return;
      const extracted = extractSharedUrls(undefined, clipboard);
      const urls = extracted.length ? extracted : clipboard.trim() ? [clipboard.trim()] : [];
      if (!urls.length) { setError("Clipboard is empty. Copy a link first."); return; }
      setLinks((previous) => pasteBookmarkDrafts(previous, id, urls, () => nextLinkId.current++));
      setError("");
      requestAnimationFrame(() => {
        if (!active.current || epoch !== pasteEpoch.current || revision !== draftRevision.current) return;
        // Keep the clipboard draft when a picker/create/unlock surface opened
        // meanwhile, but never pull focus or the IME back to the background.
        if (surfaceRef.current !== "form") return;
        // Paste is explicit user intent for this field, so reopening the IME
        // here is appropriate. The helper only resets this same field on the
        // Android Back-hid-the-IME edge; it never blurs another surface.
        editLink(id);
      });
    } catch {
      if (active.current && epoch === pasteEpoch.current && revision === draftRevision.current) {
        setError("Clipboard access is blocked. Paste the link manually.");
      }
    }
  };

  const unlocking = Boolean(lockedFolderId);
  const linkCount = links.filter((draft) => draft.url.trim()).length;
  const invalidIndex = links.findIndex((draft) => draft.error);
  const validation = invalidIndex < 0 ? "" : `Link ${invalidIndex + 1}: ${links[invalidIndex].error}`;
  const linkActions = useBookmarkLinkActions({
    onFocus: editLink,
    onBlur: (id) => {
      if (visible && panelInteractive && entranceReady.current) {
        setActiveLinkId((current) => current === id ? null : current);
      }
    },
    onChange: (id, url) => {
      draftRevision.current += 1;
      // Native keyboard paste also arrives through onChangeText. A pasted
      // collection should never be left as one invalid, concatenated URL.
      const candidates = url.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
      const isBatch = candidates.length > 1 || candidates.some(candidate => /[,;]https?:\/\//i.test(candidate));
      const urls = isBatch ? extractSharedUrls(undefined, url) : [];
      setLinks((previous) => urls.length
        ? pasteBookmarkDrafts(previous, id, urls, () => nextLinkId.current++)
        : previous.map((link) => link.id === id ? { ...link, url, error: undefined } : link));
      if (error) setError("");
    },
    onRemove: removeLink,
    onPaste: (id) => { void pasteLink(id); },
    onNext: addLink,
  });

  return (
    <>
      <FloatingPanel
        presentation="responsive"
        dirty={links.some((link) => link.url.trim().length > 0 && !intakeUrls.includes(link.url.trim())) || selectedTagIds.slice().sort().join() !== [...initialTagIds].sort().join() || selectedFolderId !== (folderId ?? null)}
        visible={visible}
        pageKey={lockedFolderId ? "unlock" : "save"}
        obscured={panelObscured}
        interactive={panelInteractive}
        dismissible={!saving}
        dismissOnScrim={!shareIntake}
        onEntered={() => {
          entranceReady.current = true;
          // The panel dismisses the previous IME after measuring. Its blur
          // must not collapse the opening editor before focus can settle.
          if (!shareIntake && panelInteractive && activeLinkId !== null && !saving) {
            setFocusRequest((value) => value + 1);
          }
        }}
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
            <PanelHeader title={links.length > 1 ? "Save bookmarks" : "Save bookmark"} onClose={!shareIntake && !saving ? close : undefined} />
            <BookmarkLinkLayout activeIndex={links.findIndex((draft) => draft.id === activeLinkId)}
              fields={links.map((draft, index) => <BookmarkLinkField key={draft.id}
                  draft={draft} index={index} expanded={activeLinkId === draft.id}
                  disabled={saving} removable={links.length > 1}
                  autoFocus={visible && index === 0 && !shareIntake}
                  focusRequest={activeLinkId === draft.id ? focusRequest : 0}
                  focusEnabled={visible && panelInteractive}
                  actions={linkActions} />)}>
              <View>
                <Button label="Add link" variant="ghost" disabled={saving} style={styles.addLink}
                  icon={<Ionicons name="add" size={20} />} onPress={addLink} />
                <AnimatedDisclosure expanded={Boolean(error || validation)}>
                  <Text variant="bodySmall" color="danger" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error || validation}</Text>
                </AnimatedDisclosure>
              </View>

            {allowFolderSelection ? <PickerField label="Folder" value={destination ?? "Bookmarks"} dropdown expanded={destinationOpen} disabled={saving}
              icon={selectedFolder?.icon ?? "bookmark-outline"} onPress={(anchor) => { handFocusToDropdown(); setDestinationAnchor(anchor); setDestinationOpen(true); }} />
              : destination ? <Text variant="bodyMedium" color="secondary">Saving to {destination}</Text> : null}
            <PickerField label="Tags" icon="pricetags-outline" dropdown expanded={showTagPicker} disabled={saving}
              value={selectedTagIds.length ? selectedTagIds.map((id) => tags?.find((tag) => tag.id === id)?.name).filter(Boolean).join(", ") || `${selectedTagIds.length} tags selected` : "Add tags"}
              onPress={(anchor) => { handFocusToDropdown(); setTagAnchor(anchor); setShowTagPicker(true); }} />
            </BookmarkLinkLayout>
            <PanelActions
              confirmLabel={saving && linkCount > 1 ? `Saving ${Math.min(saveProgress + 1, linkCount)} of ${linkCount}` : linkCount > 1 ? `Save ${linkCount} bookmarks` : "Save bookmark"}
              onConfirm={() => void submit()}
              onCancel={close}
              loading={saving}
            />
          </>
        )}
      </FloatingPanel>
      <FolderPickerMenu visible={folderPickerOpen} onDismiss={() => setDestinationOpen(false)} folders={folders ?? []} anchor={destinationAnchor} returnFocusRef={urlRef}
        value={selectedFolderId} onChange={(id) => setSelectedDestination(id ?? ROOT_DESTINATION)}
        onCreate={() => { setDestinationOpen(false); setCreateFolderOpen(true); }} />
      <ResponsivePicker title="Tags" visible={tagPickerOpen} onDismiss={() => setShowTagPicker(false)} anchor={tagAnchor} width={tagAnchor?.width} scrollBody={false} keyboardDismiss={false} estimatedHeight={280} returnFocusRef={urlRef}>
        <View ref={tagMenuRef} {...tagOpeningFocus} style={{ paddingHorizontal: spacing[16], flexShrink: 1 }}>
        <TagSelectList selectedIds={selectedTagIds} searchInputRef={tagSearchRef}
          searchAutoFocus={Platform.OS !== "web"}
          onToggle={(tagId) => setSelectedTagIds((previous) => previous.includes(tagId) ? previous.filter((id) => id !== tagId) : [...previous, tagId])}
          menu maxHeight={240} onRequestCreateTag={() => { setShowTagPicker(false); setCreateTagOpen(true); }} />
        </View>
      </ResponsivePicker>
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
  addLink: { alignSelf: "flex-start" },
  error: { marginTop: spacing[8] },
});
