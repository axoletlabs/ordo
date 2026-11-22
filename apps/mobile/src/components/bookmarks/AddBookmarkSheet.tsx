/**
 * One save-owned surface. The form is the root page; folder, tag, creation,
 * and unlock pages fade through inside the same sheet so Back, the draft, and
 * the keyboard never move between sibling surfaces.
 */
import React, { useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { TAG_NAME_MAX_LENGTH } from "@ordo/shared";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { IconButton } from "../ui/IconButton";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { PickerField } from "../ui/PickerField";
import { PanelActions } from "../ui/SheetActionRow";
import { DraftDismissContext } from "../ui/draft-dismiss";
import { UnlockForm } from "./LockPrompt";
import { FolderIconPicker } from "./FolderIconPicker";
import { FolderSelectPage } from "./FolderSelectPage";
import { BookmarkLinkField, BookmarkLinkLayout, useBookmarkLinkActions } from "./BookmarkLinkField";
import { useCreateFolderForm } from "./CreateFolderPanel";
import { TagSelectList } from "../tags/TagSelectList";
import { TagColorPicker } from "../tags/TagColorPicker";
import { useCreateTagForm } from "../tags/CreateTagPanel";
import { useCreateBookmark } from "../../hooks/use-bookmarks";
import { useFolders } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { useSettingsStore } from "../../store/settings";
import { useTags } from "../../hooks/use-tags";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import { errorMessage, isFolderProtected } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { prefetchExtraction } from "../../lib/prefetch-extraction";
import { extractSharedUrls } from "../../lib/shared-url";
import { toast } from "../ui/toast-store";
import { spacing } from "../../theme/tokens";
import { bookmarkDraftsFromUrls, pasteBookmarkDrafts, normalizeBookmarkDraft, validateBookmarkDrafts, type BookmarkDraft } from "../../lib/bookmark-drafts";
import { LazyMount } from "../ui/LazyMount";

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
   * Share-sheet intake: don't dismiss on a scrim tap (that returns to the
   * sender on Android), and report a completed save back to the sender.
   */
  shareIntake?: boolean;
  /** Share intake only: called instead of `onDismiss` after a successful save. */
  onSaved?: (destinationLabel: string | null, count: number) => void;
}

const ROOT_DESTINATION = "__bookmarks__";
/** Stable identity so the sheet's reset effect doesn't fire on parent renders. */
const NO_TAGS: string[] = [];

/** Pages of the one save-owned surface. `unlock` is derived from the locked
 * folder, not stored here, so a save can hand off and return to the same form. */
type SavePage = "form" | "folder" | "tags" | "createFolder" | "createTag" | "unlock";
type Surface = SavePage | "closed";

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
  const { width, height } = useWindowDimensions();
  const resting = React.useRef({ width, height });
  // The IME must not switch organization controls between rows and columns.
  if (width !== resting.current.width || Platform.OS === "web") resting.current = { width, height };
  else resting.current.height = Math.max(resting.current.height, height);
  const compactForm = width >= 600 && resting.current.height < 480;
  const intakeKey = JSON.stringify(initialUrls ?? (initialUrl ? [initialUrl] : []));
  const intakeUrls = React.useMemo(() => JSON.parse(intakeKey) as string[], [intakeKey]);
  const hasIntake = intakeUrls.length > 0;
  const create = useCreateBookmark();
  const { data: folders } = useFolders();
  const { data: tags } = useTags();
  const [links, setLinks] = useState<BookmarkDraft[]>(() => bookmarkDraftsFromUrls(intakeUrls));
  const nextLinkId = React.useRef(Math.max(1, intakeUrls.length));
  const [page, setPage] = useState<SavePage>("form");
  const [activeLinkId, setActiveLinkId] = useState<number | null>(shareIntake && hasIntake ? null : 0);
  const [focusRequest, setFocusRequest] = useState(0);
  /** True once the panel's entrance has settled; the opening IME blur must
   * not collapse the editor before its focus take can land. */
  const entranceReady = React.useRef(false);
  /** Last field the user worked in; paste, add, and prefetch all follow it. */
  const activeLink = React.useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const saveRun = React.useRef<object | null>(null);
  const pasteEpoch = React.useRef(0);
  /** Bumped by any user/external URL edit; a pending clipboard read from an
   * older revision must never overwrite newer text (or refocus it). */
  const draftRevision = React.useRef(0);
  const active = React.useRef(visible);
  const [error, setError] = useState("");
  const [lockedFolderId, setLockedFolderId] = useState<string | null>(null);
  /** The icon picker is a sibling overlay of the save sheet. */
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialTagIds);
  const [selectedDestination, setSelectedDestination] = useState(folderId ?? ROOT_DESTINATION);
  const selectedFolderId = selectedDestination === ROOT_DESTINATION ? null : selectedDestination;
  const selectedFolder = folders?.find((folder) => folder.id === selectedFolderId);
  const destination = destinationLabel(
    selectedFolderId,
    allowFolderSelection ? selectedFolder?.name : folderName,
  );

  // Exactly one page owns focus/Back. Deriving it from `visible` means a parent
  // close releases every child page in the same commit, before any reset.
  const shownPage: SavePage = lockedFolderId ? "unlock" : page;
  const surface: Surface = visible ? shownPage : "closed";
  const surfaceRef = React.useRef<Surface>(surface);
  const listPage = shownPage === "folder" || shownPage === "tags";

  // A fresh opening always starts on the form. Adjusting during render (like
  // the session token below) lets the opening commit paint the form instead of
  // fading a stale page out over the entrance.
  const wasVisible = React.useRef(visible);
  if (visible && !wasVisible.current) {
    wasVisible.current = true;
    if (page !== "form") setPage("form");
  } else if (!visible) {
    wasVisible.current = false;
  }

  // Stable content key: callers may pass a fresh same-value array (or the same
  // set in another order) on every render, which is not a new intent and must
  // not reset an active draft.
  const tagKey = [...new Set(initialTagIds)].sort().join("\u0000");
  const appliedProps = React.useRef({ visible: false, folderId, intakeKey, tagKey });
  // One applied open/intake session. Render-adjusted state, not a mutable
  // ref: a discarded concurrent render must not invent a close/new URL and
  // then silently suppress or mis-focus a save that belongs to the live
  // session. Stable across clipboard requests and page changes; closing or a
  // different intake URL starts a new token. The committed token is published
  // before paint below, so real closes invalidate in-flight saves.
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

  /** A Save-owned child callback may only act for the page that was rendered in
   * the same applied session. The token is captured by this render closure, so
   * a stale await from a closed/reopened session cannot attach its folder/tag
   * to the new draft or navigate the new page. */
  const ownsChild = (expected: Surface) => active.current
    && surfaceRef.current === expected
    && session.token === committedSession.current;

  // Owner close: release the unlock page and pending clipboard work before
  // paint. The visible page is retained through the exit fade, so it is reset
  // when the next opening commits instead of swapping under the fade.
  React.useLayoutEffect(() => {
    if (visible) return;
    appliedProps.current.visible = false;
    pasteEpoch.current += 1;
    draftRevision.current += 1;
    entranceReady.current = false;
    setLockedFolderId(null);
    setIconPickerOpen(false);
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
      activeLink.current = null;
      saveRun.current = null;
      setSaving(false);
      setError("");
      setLockedFolderId(null);
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
      activeLink.current = null;
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
    const link = links.find((draft) => draft.id === (activeLink.current ?? links[0]?.id));
    if (!link?.url.trim()) return;
    const handle = setTimeout(() => prefetchExtraction(link.url), 400);
    return () => clearTimeout(handle);
  }, [links, visible]);

  const reset = () => {
    pasteEpoch.current += 1;
    draftRevision.current += 1;
    setLinks([{ id: 0, url: "" }]);
    setActiveLinkId(0);
    setFocusRequest(0);
    activeLink.current = null;
    setError("");
    setLockedFolderId(null);
    setSelectedDestination(folderId ?? ROOT_DESTINATION);
    setPage("form");
    setSelectedTagIds(initialTagIds);
    setIconPickerOpen(false);
  };

  const close = () => {
    // FloatingPanel retains the draft through its exit transition.
    onDismiss();
  };

  /** Programmatic focus retarget: expand the row, then let its field take
   * the IME one frame after the layout commit (BookmarkLinkField defers the
   * focus take so the just-mounted Android view can receive it). */
  const editLink = (id: number, input: TextInput | null = null) => {
    if (saving || saveRun.current) return;
    activeLink.current = id;
    setActiveLinkId(id);
    if (!input) {
      pasteEpoch.current += 1;
      setFocusRequest((value) => value + 1);
    }
  };

  const addLink = () => {
    if (saving || saveRun.current) return;
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

  const changeLink = (id: number, url: string) => {
    draftRevision.current += 1;
    activeLink.current = id;
    // Native keyboard paste also arrives through onChangeText. A pasted
    // collection should never be left as one invalid, concatenated URL.
    const candidates = url.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
    const isBatch = candidates.length > 1 || candidates.some(candidate => /[,;]https?:\/\//i.test(candidate));
    const urls = isBatch ? extractSharedUrls(undefined, url) : [];
    setLinks((previous) => urls.length
      ? pasteBookmarkDrafts(previous, id, urls, () => nextLinkId.current++)
      : previous.map((link) => link.id === id ? { ...link, url, error: undefined } : link));
    if (error) setError("");
  };

  const goToPage = (next: SavePage) => {
    if (saving || saveRun.current) return;
    // Organization is a deliberate place, not another text field: leave the
    // IME once instead of hiding and reopening it on every handoff.
    if (next !== "form") dismissKeyboard();
    setPage(next);
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
        activeLink.current = null;
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
        // Keep the clipboard draft when another page opened meanwhile, but
        // never pull focus or the IME back to the background.
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

  const linkActions = useBookmarkLinkActions({
    onFocus: editLink,
    onBlur: (id) => {
      // A real blur (Add link, picker handoff, scrim) collapses the editor;
      // the entrance settle and field-to-field handoffs never reach here.
      if (visible && active.current && surfaceRef.current === "form" && entranceReady.current) {
        setActiveLinkId((current) => (current === id ? null : current));
      }
    },
    onChange: changeLink,
    onRemove: removeLink,
    onPaste: (id) => { void pasteLink(id); },
    onNext: addLink,
  });
  const folderForm = useCreateFolderForm(visible, (folder) => {
    if (!ownsChild("createFolder")) return;
    setSelectedDestination(folder.id);
    setPage("form");
  });
  const tagForm = useCreateTagForm(visible, (tag) => {
    if (!ownsChild("createTag")) return;
    setSelectedTagIds((previous) => previous.includes(tag.id) ? previous : [...previous, tag.id]);
    setPage("tags");
  });
  const creating = page === "createFolder" ? folderForm.busy : page === "createTag" && tagForm.busy;
  const backToForm = () => {
    if (!saving && !creating) {
      dismissKeyboard();
      setPage("form");
    }
  };
  const backOnePage = () => {
    if (saving || creating) return;
    dismissKeyboard();
    if (lockedFolderId) setLockedFolderId(null);
    else setPage(page === "createFolder" ? "folder" : page === "createTag" ? "tags" : "form");
  };

  const lockedFolder = folders?.find((folder) => folder.id === lockedFolderId);
  const unlocking = Boolean(lockedFolderId);
  const linkCount = links.filter((draft) => draft.url.trim()).length;
  const tagNames = selectedTagIds
    .map((id) => tags?.find((tag) => tag.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const tagsLabel = selectedTagIds.length === 0 ? "Add tags"
    : tagNames || `${selectedTagIds.length} tags selected`;
  const backButton = (
    <IconButton name="arrow-back" variant="standard" accessibilityLabel="Back" disabled={creating} onPress={backOnePage} />
  );
  const confirmLabel = saving && linkCount > 1
    ? `Saving ${Math.min(saveProgress + 1, linkCount)} of ${linkCount}`
    : linkCount > 1 ? `Save ${linkCount} bookmarks` : "Save bookmark";

  let content: React.ReactNode;
  if (shownPage === "unlock") {
    content = lockedFolderId ? (
      <DraftDismissContext.Provider value={null}>
        <UnlockForm
          folderId={lockedFolderId}
          folderName={lockedFolder?.name}
          lockType={lockedFolder?.lockType}
          pinLength={lockedFolder?.pinLength}
          autoPromptDevice
          presented={visible}
          cancelLabel="Back"
          onCancel={() => { if (ownsChild("unlock")) setLockedFolderId(null); }}
          onUnlocked={() => {
            if (!ownsChild("unlock")) return;
            setLockedFolderId(null);
            void submit();
          }}
        />
      </DraftDismissContext.Provider>
    ) : null;
  } else if (shownPage === "folder") {
    content = (
      <>
        <PanelHeader title="Save to folder" leading={backButton} />
        <FolderSelectPage
          folders={folders ?? []}
          value={selectedFolderId}
          onSelect={(id) => {
            if (saving) return;
            dismissKeyboard();
            setSelectedDestination(id ?? ROOT_DESTINATION);
            setPage("form");
          }}
          onCreate={() => goToPage("createFolder")}
        />
      </>
    );
  } else if (shownPage === "tags") {
    content = (
      <>
        <PanelHeader title="Tags" leading={backButton} />
        <TagSelectList
          selectedIds={selectedTagIds}
          onToggle={(tagId) => {
            if (!ownsChild("tags")) return;
            setSelectedTagIds((previous) => previous.includes(tagId)
              ? previous.filter((id) => id !== tagId) : [...previous, tagId]);
          }}
          onRequestCreateTag={() => goToPage("createTag")}
        />
        <PanelActions confirmLabel="Done" onConfirm={backToForm} fullWidth />
      </>
    );
  } else if (shownPage === "createFolder") {
    content = (
      <>
        <PanelHeader title="New folder" leading={backButton} />
        <DraftDismissContext.Provider value={null}>
          <View style={styles.form}>
            <Input
              label="Name"
              required showRequiredIndicator={false} maxLength={100} showCounter
              value={folderForm.name}
              onChangeText={folderForm.setName}
              placeholder="e.g. Recipes"
              disabled={folderForm.busy}
              error={folderForm.error || undefined}
              onSubmitEditing={() => void folderForm.submit()}
            />
            <FolderIconPicker value={folderForm.icon} onChange={folderForm.setIcon} onOpenChange={setIconPickerOpen} disabled={folderForm.busy} />
          </View>
        </DraftDismissContext.Provider>
        <PanelActions
          confirmLabel="Create folder"
          onConfirm={() => void folderForm.submit()}
          loading={folderForm.busy}
          fullWidth
        />
      </>
    );
  } else if (shownPage === "createTag") {
    content = (
      <>
        <PanelHeader title="New tag" leading={backButton} />
        <DraftDismissContext.Provider value={null}>
          <View style={styles.form}>
            <Input
              label="Tag name"
              required maxLength={TAG_NAME_MAX_LENGTH} showCounter
              value={tagForm.name}
              onChangeText={tagForm.setName}
              placeholder="Tag name"
              autoCapitalize="words"
              disabled={tagForm.busy}
              error={tagForm.error || undefined}
              returnKeyType="done"
              onSubmitEditing={() => void tagForm.submit()}
            />
            <Text variant="label" color="tertiary" style={styles.colorLabel}>Color</Text>
            <TagColorPicker value={tagForm.color} onChange={tagForm.setColor} />
          </View>
        </DraftDismissContext.Provider>
        <PanelActions
          confirmLabel="Create tag"
          onConfirm={() => void tagForm.submit()}
          loading={tagForm.busy}
          fullWidth
        />
      </>
    );
  } else {
    content = (
      <>
        <PanelHeader
          title={links.length > 1 ? "Save bookmarks" : "Save bookmark"}
          onClose={!shareIntake && !saving ? close : undefined}
        />
        <View style={[styles.form, compactForm && styles.compactForm]}>
          <BookmarkLinkLayout
            activeIndex={links.findIndex((draft) => draft.id === activeLinkId)}
            fields={links.map((draft, index) => <BookmarkLinkField key={draft.id}
              draft={draft} index={index} expanded={activeLinkId === draft.id}
              disabled={saving} removable={links.length > 1}
              autoFocus={visible && index === 0 && !shareIntake}
              focusRequest={activeLinkId === draft.id ? focusRequest : 0}
              focusEnabled={visible && !creating && !saving}
              actions={linkActions} />)}
          >
            <Button
              label="Add link"
              variant="ghost"
              icon={<Ionicons name="add" size={20} />}
              disabled={saving}
              style={styles.addLink}
              onPress={addLink}
            />
          </BookmarkLinkLayout>
          <View style={[styles.meta, compactForm && styles.compactMeta]}>
            {allowFolderSelection ? (
              <View style={compactForm && styles.compactPicker}>
                <PickerField
                  label="Folder"
                  value={destination ?? "Bookmarks"}
                  icon={selectedFolder?.icon ?? "bookmark-outline"}
                  disabled={saving}
                  onPress={() => goToPage("folder")}
                />
              </View>
            ) : destination ? (
              <Text variant="bodyMedium" color="secondary" style={compactForm && styles.compactPicker}>Saving to {destination}</Text>
            ) : null}
            <View style={compactForm && styles.compactPicker}>
              <PickerField
                label="Tags"
                value={tagsLabel}
                icon="pricetags-outline"
                disabled={saving}
                onPress={() => goToPage("tags")}
              />
            </View>
          </View>
        </View>
        <PanelActions
          confirmLabel={confirmLabel}
          onConfirm={() => void submit()}
          onCancel={shareIntake && !saving ? close : undefined}
          cancelLabel="Cancel"
          loading={saving}
          fullWidth
        >
          {error ? (
            <Text
              variant="bodySmall"
              color="danger"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={styles.saveError}
            >
              {error}
            </Text>
          ) : null}
        </PanelActions>
      </>
    );
  }

  return (
    <FloatingPanel
      presentation="responsive"
      // Track the collection here: removed fields must not leave ghost edits
      // in the panel's individual-input draft registry.
      dirty={links.some((link) => link.url.trim().length > 0 && !intakeUrls.includes(link.url.trim()))
        || selectedTagIds.slice().sort().join() !== [...initialTagIds].sort().join()
        || selectedFolderId !== (folderId ?? null)}
      visible={visible}
      pageKey={shownPage}
      scrollBody={!listPage}
      obscured={iconPickerOpen}
      dismissible={!saving && !creating}
      dismissOnScrim={!shareIntake}
      onEntered={() => {
        entranceReady.current = true;
        // The entrance dismisses the previous IME; its blur must not collapse
        // the opening editor. A returning picker page retakes focus here too.
        if (!shareIntake && activeLinkId !== null && !saving) {
          setFocusRequest((value) => value + 1);
        }
      }}
      onDismissAttempt={() => {
        // Back, a scrim tap, or a downward drag goes back one page first.
        if (lockedFolderId || page !== "form") { backOnePage(); return true; }
        return false;
      }}
      onDismiss={() => {
        if (unlocking) setLockedFolderId(null);
        else close();
      }}
    >
      {content}
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing[16] },
  compactForm: { gap: spacing[8] },
  addLink: { alignSelf: "flex-start" },
  meta: { gap: spacing[16], marginTop: spacing[8] },
  compactMeta: { flexDirection: "row", gap: spacing[12], marginTop: 0, alignItems: "center" },
  compactPicker: { flex: 1, minWidth: 0 },
  colorLabel: { marginTop: spacing[16], marginBottom: spacing[8] },
  saveError: { marginBottom: spacing[8] },
});
