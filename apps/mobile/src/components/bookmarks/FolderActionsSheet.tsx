import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { APP_NAME, DEFAULT_FOLDER_ICON, type BookmarkDto, type FolderDto, type FolderIcon, type FolderLockType, type FolderPinLength } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { ThemedFlatList, ThemedScrollView } from "../ui/ThemedScrollView";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { AutofillForm } from "../ui/AutofillForm";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { ContextMenu, ContextMenuItem, ContextMenuNote } from "../ui/ContextMenu";
import { PanelActions, sheetMenuStyles } from "../ui/SheetActionRow";
import { EyeToggle } from "../ui/EyeToggle";
import { PressableScale } from "../ui/PressableScale";
import { Segmented } from "../ui/Segmented";
import { SettingRow } from "../ui/SettingRow";
import { ListPressable } from "../ui/ListPressable";
import { Spinner } from "../ui/Spinner";
import { OtpInput } from "../ui/OtpInput";
import { FolderIconGrid } from "./FolderIconPicker";
import { PatternInput } from "./PatternInput";
import { useTheme } from "../../theme/ThemeProvider";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { radius, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { toast } from "../ui/toast-store";
import { domainFromUrl } from "../../lib/format";
import { errorMessage } from "../../lib/error-message";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import { foldersApi } from "../../lib/api/folders";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { useFolderBookmarkOptions } from "../../hooks/use-bookmarks";
import {
  createDeviceLockCredential,
  deleteDeviceLockCredential,
  getDeviceLockCredential,
  isDeviceLockAvailable,
} from "../../lib/device-folder-lock";
import {
  invalidateBookmarks,
  patchFolderLock,
  useDeleteFolder,
  useFolderUnlocked,
  useRenameFolder,
  useUpdateFolder,
} from "../../hooks/use-folders";
import { useServerInfo } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { folderKey } from "../../hooks/use-selection";
import { useMenuHighlight } from "../../hooks/use-menu-highlight";
import { useOverlaySessionMode } from "../../lib/overlay-session-mode";
import { localPasswordAutofillProps, passwordAutofillProps } from "../../lib/password-autofill";
import { AccountAutofillIdentity } from "../auth/AccountAutofillIdentity";
import { LazyMount } from "../ui/LazyMount";
import { AnimatedDisclosure } from "../ui/AnimatedDisclosure";

type Mode = "menu" | "rename" | "lockChoice" | "lockCredential" | "icon" | "delete" | "removePassword" | "removePasswordAccount";

export interface FolderActionsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  folder: FolderDto | null;
  anchor?: MenuAnchorRect | null;
  onDeleted?: (id: string) => void;
  /** Called after a lock is applied, so hosts can skip immediately prompting to unlock. */
  onLockSet?: () => void;
}

export function FolderActionsSheet(props: FolderActionsSheetProps) {
  return <LazyMount active={props.visible}>{() => <FolderActionsContent {...props} />}</LazyMount>;
}

function FolderActionsContent({ visible, onDismiss, folder, anchor, onDeleted, onLockSet }: FolderActionsSheetProps) {
  const { palette } = useTheme();
  const serverInfo = useServerInfo();
  /** Older servers drop lockType and silently store every lock as a password. */
  const lockTypesSupported = serverInfo.data?.folderLockTypes === true;
  const rename = useRenameFolder();
  const update = useUpdateFolder();
  const del = useDeleteFolder();
  const clearToken = useFolderTokenStore((state) => state.clear);
  const [mode, setMode] = useOverlaySessionMode<Mode>(visible, "menu");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [lockType, setLockType] = useState<FolderLockType>("password");
  const [pattern, setPattern] = useState<number[]>([]);
  const [savedPattern, setSavedPattern] = useState<number[]>([]);
  const [pinLength, setPinLength] = useState<FolderPinLength>(4);
  const [savedPin, setSavedPin] = useState("");
  const [deviceLockAvailable, setDeviceLockAvailable] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [icon, setIcon] = useState<FolderIcon>(DEFAULT_FOLDER_ICON);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [keepIds, setKeepIds] = useState<string[]>([]);
  const lockingRef = React.useRef(false);
  const busy = locking || removing || rename.isPending || update.isPending;
  const folderRef = React.useRef(folder);
  if (folder) folderRef.current = folder;
  const displayFolder = folder ?? folderRef.current;
  const folderUnlocked = useFolderUnlocked(displayFolder?.id);
  const deleteAccessBlocked = Boolean(displayFolder?.protected && !folderUnlocked);
  const { height } = useResponsiveLayout();
  const deleteOpen = visible && mode === "delete";
  const verifyEmptyFolder = (displayFolder?.bookmarkCount ?? 0) === 0;

  // Warm the keep picker while the confirmation opens, before its expansion
  // puts the request on the interaction path. This also verifies cached zero
  // counts: stale metadata must never hide bookmarks that can be kept.
  const keepOptions = useFolderBookmarkOptions(
    displayFolder?.id ?? null,
    deleteOpen && !deleteAccessBlocked,
  );
  const keepCount = keepIds.length;
  const keepTotal = keepOptions.data ? keepOptions.data.length : displayFolder?.bookmarkCount ?? 0;
  // Reserve the same viewport for loading and loaded rows. A maxHeight alone
  // lets FlatList's empty/loading content and rows size the dialog differently,
  // producing a second jump when the request finishes. Keep long lists virtual.
  const keepListHeight = Math.min(320, height * 0.45,
    Math.max(120, keepTotal * (64 + spacing[2]) + spacing[2]));
  // Describe the outcome here so the delete action can keep a stable label.
  const deleteSubtitle =
    keepCount > 0
      ? "Selected bookmarks will move to Bookmarks. This folder and any unselected bookmarks will be deleted. You can undo this."
      : keepTotal > 0 || keepOptions.isPending
        ? "This folder and its bookmarks will be deleted. Select any bookmarks you want to keep. You can undo this."
        : "This empty folder will be deleted. You can undo this.";
  // The collapsed summary must carry the folder's real count: a bare "None"
  // reads as "no bookmarks to keep" even when the folder is full. Ticked and
  // unticked states share the same "n of total" format; "None" remains only
  // for a verified-empty folder, whose row is hidden anyway. A locked folder
  // never checks (the picker stays disabled), so it must not claim to be
  // checking either.
  const keepValue =
    deleteAccessBlocked
      ? "Locked"
      : keepCount > 0
        ? `${keepCount} of ${keepTotal}`
        : keepOptions.isPending
          ? "Checking…"
          : keepOptions.isError
            ? "Try again"
            : keepTotal > 0
              ? `0 of ${keepTotal}`
              : "None";
  // Verify a cached empty count before allowing deletion. A failed check must
  // leave the picker available so the user can retry rather than blindly delete.
  const keepChoiceBlocked = (keepOpen || verifyEmptyFolder) && (keepOptions.isPending || keepOptions.isError);
  const showKeepRow = keepTotal > 0 || keepCount > 0 || (verifyEmptyFolder && keepChoiceBlocked);

  // Nested pages share ownership; final dismissal starts the row's fade now.
  useMenuHighlight(visible, displayFolder ? folderKey(displayFolder.id) : null);

  React.useEffect(() => {
    if (!visible) return;
    const currentFolder = folderRef.current;
    setMode("menu");
    setName(currentFolder?.name ?? "");
    setPassword("");
    setConfirmPassword("");
    setLockType("password");
    setPattern([]);
    setSavedPattern([]);
    setPinLength(4);
    setSavedPin("");
    setShowPassword(false);
    setAccountPassword("");
    setShowAccountPassword(false);
    setIcon(currentFolder?.icon ?? DEFAULT_FOLDER_ICON);
    setError("");
    setRemoving(false);
    void isDeviceLockAvailable().then(setDeviceLockAvailable);
  }, [visible, folder?.id]);

  // Keep choices belong to the folder being deleted, not to this sheet session:
  // reopening the same folder restores the ticks, a different folder starts clean.
  // Comparing only while visible keeps a retained exit panel from flashing its
  // collapsed state while the host clears the folder during dismissal.
  const keepTargetRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!visible) return;
    const id = folder?.id ?? null;
    if (keepTargetRef.current === id) return;
    keepTargetRef.current = id;
    setKeepOpen(false);
    setKeepIds([]);
  }, [visible, folder?.id]);

  const showMode = (nextMode: Mode) => {
    if (busy || lockingRef.current) return;
    dismissKeyboard();
    setError("");
    if (nextMode !== "lockCredential" && nextMode !== "removePassword") {
      setPassword("");
      setConfirmPassword("");
      setPattern([]);
      setSavedPattern([]);
      setSavedPin("");
      setPinLength(4);
      setShowPassword(false);
    }
    if (nextMode === "removePassword" && folderRef.current?.lockType === "pin") {
      setPinLength(folderRef.current.pinLength === 6 ? 6 : 4);
      setPassword("");
    }
    if (nextMode === "lockCredential") {
      setSavedPin("");
      setPinLength(4);
    }
    if (nextMode !== "removePasswordAccount") {
      setAccountPassword("");
      setShowAccountPassword(false);
    }
    setMode(nextMode);
  };

  const doRename = async () => {
    if (!folder || busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a folder name.");
      return;
    }
    try {
      await rename.mutateAsync({ id: folder.id, name: trimmed });
      haptics.success();
      toast.success("Folder renamed");
      onDismiss();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const doUpdateIcon = async () => {
    if (!folder || busy) return;
    try {
      await update.mutateAsync({ id: folder.id, input: { icon } });
      haptics.success();
      toast.success("Folder icon updated");
      onDismiss();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const doTogglePinned = async () => {
    if (!folder || update.isPending) return;
    try {
      await update.mutateAsync({ id: folder.id, input: { pinned: !folder.pinned } });
      haptics.success();
      toast.success(folder.pinned ? "Folder unpinned" : "Folder pinned");
      onDismiss();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const doSetCredential = async (patternOverride?: number[], pinOverride?: string) => {
    if (!folder || busy || lockingRef.current) return;
    const nodes = patternOverride ?? pattern;
    const pin = pinOverride ?? password;
    const credential = lockType === "pattern" ? nodes.join("-") : lockType === "pin" ? pin : password;
    if (lockType === "pattern") {
      if (nodes.length < 4) {
        setError("Connect at least 4 dots.");
        setPattern([]);
        return;
      }
      if (savedPattern.length === 0) {
        setSavedPattern(nodes);
        setPattern([]);
        setError("");
        return;
      }
      if (savedPattern.join("-") !== credential) {
        setError("Patterns do not match. Try again.");
        return;
      }
    }
    if (lockType === "pin") {
      if (pin.length !== pinLength) {
        setError(`Enter a ${pinLength}-digit PIN.`);
        return;
      }
      if (!savedPin) {
        setSavedPin(pin);
        setPassword("");
        setError("");
        return;
      }
      if (savedPin !== pin) {
        setError("PINs do not match. Try again.");
        return;
      }
    }
    if (lockType === "password" && password.length < 4) {
      setError("Use at least 4 characters.");
      return;
    }
    if (lockType === "password" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    lockingRef.current = true;
    setLocking(true);
    try {
      await foldersApi.setPassword(folder.id, { password: credential, lockType });
      patchFolderLock(folder.id, {
        protected: true,
        lockType,
        pinLength: lockType === "pin" ? pinLength : null,
      });
      clearToken(folder.id);
      invalidateBookmarks();
      onLockSet?.();
      haptics.success();
      toast.success("Folder locked");
      onDismiss();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      lockingRef.current = false;
      setLocking(false);
    }
  };

  const doSetDeviceLock = async () => {
    if (!folder) return;
    if (!deviceLockAvailable) {
      setError("Set up fingerprint or face unlock on this device first.");
      return;
    }
    setRemoving(true);
    setError("");
    try {
      const credential = await createDeviceLockCredential(folder.id);
      try {
        await foldersApi.setPassword(folder.id, { password: credential, lockType: "device" });
      } catch (cause) {
        await deleteDeviceLockCredential(folder.id).catch(() => undefined);
        throw cause;
      }
      patchFolderLock(folder.id, { protected: true, lockType: "device" });
      clearToken(folder.id);
      invalidateBookmarks();
      onLockSet?.();
      haptics.success();
      toast.success("Folder locked");
      onDismiss();
    } catch (cause) {
      setError(errorMessage(cause, "Could not enable the device lock."));
    } finally {
      setRemoving(false);
    }
  };

  const finishRemoved = () => {
    if (!folder) return;
    patchFolderLock(folder.id, { protected: false, lockType: null, pinLength: null });
    clearToken(folder.id);
    invalidateBookmarks();
    haptics.success();
    toast.success("Lock removed");
    void deleteDeviceLockCredential(folder.id).catch((cause) => console.warn("Device lock credential cleanup failed", cause));
    onDismiss();
  };

  const removeWithDeviceLock = async () => {
    if (!folder || removing) return;
    setError("");
    setRemoving(true);
    let credential: string | null;
    try {
      credential = await getDeviceLockCredential(folder.id);
      if (!credential) {
        setError("This device no longer has the folder key. Use your account password instead.");
        setRemoving(false);
        return;
      }
    } catch {
      haptics.error();
      setError("Device authentication was cancelled or unsuccessful.");
      setRemoving(false);
      return;
    }
    try {
      await foldersApi.removePassword(folder.id, { folderPassword: credential });
      finishRemoved();
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause));
    } finally {
      setRemoving(false);
    }
  };

  const removeWithFolderPassword = async (patternOverride?: number[], pinOverride?: string) => {
    if (!folder || removing) return;
    const lockKind = folder.lockType ?? "password";
    const nodes = patternOverride ?? pattern;
    const pin = pinOverride ?? password;
    const credential =
      lockKind === "pattern" ? nodes.join("-") : lockKind === "pin" ? pin : password;
    if (lockKind === "pin" && pin.length !== pinLength) {
      setError(`Enter the ${pinLength}-digit PIN.`);
      return;
    }
    if (!credential || (lockKind === "pattern" && nodes.length < 4)) {
      setError(lockKind === "pattern" ? "Connect at least 4 dots." : `Enter the folder ${lockKind === "pin" ? "PIN" : "password"}.`);
      return;
    }
    setError("");
    setRemoving(true);
    try {
      await foldersApi.removePassword(folder.id, { folderPassword: credential });
      finishRemoved();
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause, lockKind === "pattern" ? "That pattern is incorrect." : "That password is incorrect."));
    } finally {
      setRemoving(false);
    }
  };

  const submitAccountBypass = async () => {
    if (!folder || removing) return;
    setError("");
    if (!accountPassword) {
      setError("Enter your account password.");
      return;
    }
    setRemoving(true);
    try {
      await foldersApi.removePassword(folder.id, { accountPassword });
      finishRemoved();
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause));
    } finally {
      setRemoving(false);
    }
  };

  const doDelete = () => {
    if (!folder || busy || keepChoiceBlocked || deleteAccessBlocked) return;
    haptics.medium();
    del.mutate(folder, {
      keepIds,
      onDeleted: () => {
        onDeleted?.(folder.id);
        onDismiss();
      },
    });
  };

  const toggleKeep = (id: string) => {
    setKeepIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  };

  const menuOpen = visible && !!displayFolder && (mode === "menu" || mode === "lockChoice");
  const dialogOpen = visible && !!displayFolder && mode !== "menu" && mode !== "lockChoice" && mode !== "delete";

  return (
    <>
      <ContextMenu visible={menuOpen} dismissible={!busy} onDismiss={onDismiss} anchor={anchor ?? null} pageKey={mode} sessionKey={displayFolder?.id}>
        {displayFolder && mode === "menu" ? (
          <>
            {error ? <ContextMenuNote tone="danger">{error}</ContextMenuNote> : null}
            <ContextMenuItem icon={displayFolder.pinned ? "pin" : "pin-outline"} label={displayFolder.pinned ? "Unpin folder" : "Pin folder"} disabled={busy} busy={update.isPending} onPress={doTogglePinned} />
            <ContextMenuItem icon="happy-outline" label="Change icon" disabled={busy} onPress={() => showMode("icon")} />
            <ContextMenuItem icon="create-outline" label="Rename" disabled={busy} onPress={() => showMode("rename")} />
            {displayFolder.protected ? (
              <ContextMenuItem icon="lock-open-outline" label="Remove lock" disabled={busy} onPress={() => showMode("removePassword")} />
            ) : (
              <ContextMenuItem icon="lock-closed-outline" label="Lock folder" disabled={busy} onPress={() => showMode("lockChoice")} />
            )}
            <ContextMenuItem icon="trash-outline" label="Delete folder" tone="danger" disabled={busy} onPress={() => showMode("delete")} />
          </>
        ) : null}
        {displayFolder && mode === "lockChoice" ? (
          <>
            <ContextMenuItem icon="chevron-back" label="Back" onPress={() => showMode("menu")} disabled={removing} />
            {error ? <ContextMenuNote tone="danger">{error}</ContextMenuNote> : null}
            {serverInfo.data && !lockTypesSupported ? (
              <ContextMenuNote tone="tertiary">
                Update your {APP_NAME} server to use pattern, PIN, and device locks.
              </ContextMenuNote>
            ) : null}
            {lockTypesSupported ? (
              <>
                <ContextMenuItem icon="finger-print-outline" label="Device lock" onPress={doSetDeviceLock} disabled={removing} />
                <ContextMenuItem icon="apps-outline" label="Pattern" disabled={busy} onPress={() => { setLockType("pattern"); showMode("lockCredential"); }} />
                <ContextMenuItem icon="keypad-outline" label="PIN" disabled={busy} onPress={() => { setLockType("pin"); showMode("lockCredential"); }} />
              </>
            ) : null}
            <ContextMenuItem icon="text-outline" label="Text password" disabled={busy} onPress={() => { setLockType("password"); showMode("lockCredential"); }} />
          </>
        ) : null}
      </ContextMenu>

      <FloatingPanel visible={dialogOpen} dismissible={!busy} onDismiss={onDismiss}>
      {folder && mode === "rename" ? (
        <>
          <PanelHeader title="Rename folder" />
          <Input
            label="Name"
            disabled={busy}
            required maxLength={100} showCounter
            value={name}
            onChangeText={setName}
            autoFocus
            error={error || undefined}
            onSubmitEditing={doRename}
          />
          <PanelActions
            confirmLabel="Save"
            onConfirm={doRename}
            onCancel={() => showMode("menu")}
            loading={rename.isPending}
            cancelDisabled={busy}
          />
        </>
      ) : null}

      {folder && mode === "lockCredential" ? (
        <>
          <PanelHeader
            title={
              lockType === "pattern"
                ? (savedPattern.length ? "Confirm pattern" : "Set a pattern")
                : lockType === "pin"
                  ? (savedPin ? "Confirm PIN" : "Set a PIN")
                  : "Set a password"
            }
            subtitle={
              lockType === "pattern"
                ? (savedPattern.length ? "Draw the same pattern again." : "Connect at least 4 dots.")
                : lockType === "pin"
                  ? (savedPin ? "Enter the same PIN again." : "Choose 4 or 6 digits.")
                  : "At least 4 characters."
            }
          />
          {lockType === "pattern" ? (
            <>
              <PatternInput
                key={savedPattern.length ? "confirm" : "set"}
                value={pattern}
                onChange={(nodes) => {
                  setPattern(nodes);
                  if (error) setError("");
                }}
                onComplete={(nodes) => void doSetCredential(nodes)}
                error={Boolean(error)}
                disabled={busy}
              />
              {error ? <Text variant="footnote" color="danger" align="center">{error}</Text> : null}
            </>
          ) : lockType === "pin" ? (
            <View>
              {savedPin ? null : (
                <Segmented
                  accessibilityLabel="PIN length"
                  disabled={busy}
                  options={[
                    { value: "4", label: "4 digits" },
                    { value: "6", label: "6 digits" },
                  ]}
                  value={String(pinLength) as "4" | "6"}
                  onChange={(value) => {
                    setPinLength(value === "6" ? 6 : 4);
                    setPassword("");
                    setError("");
                  }}
                />
              )}
              <OtpInput
                key={`${pinLength}-${savedPin ? "confirm" : "set"}`}
                purpose="pin"
                length={pinLength}
                value={password}
                onChange={(value) => {
                  setPassword(value);
                  if (error) setError("");
                }}
                onComplete={(code) => void doSetCredential(undefined, code)}
                status={locking ? "loading" : error ? "error" : "idle"}
                editable={!busy}
                error={error || undefined}
                style={savedPin ? undefined : styles.pinBoxes}
              />
            </View>
          ) : (
            <AutofillForm>
              <Input
                label="Password"
                disabled={busy}
                nativeID="folder-new-password"
                required
                value={password}
                onChangeText={setPassword}
                placeholder="At least 4 characters"
                secureTextEntry={!showPassword}
                {...localPasswordAutofillProps}
                autoFocus
                error={error || undefined}
                autoCapitalize="none"
                autoCorrect={false}
                rightAccessory={<EyeToggle visible={showPassword} onPress={() => setShowPassword((value) => !value)} />}
              />
              <Input
                label="Confirm password"
                disabled={busy}
                nativeID="folder-confirm-password"
                required
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Enter password again"
                secureTextEntry
                {...localPasswordAutofillProps}
                autoCapitalize="none"
                autoCorrect={false}
                containerStyle={styles.confirmInput}
              />
            </AutofillForm>
          )}
          <View style={sheetMenuStyles.stack}>
            {lockType === "pattern" || lockType === "pin" ? (
              <Button label="Back" variant="secondary" disabled={busy} onPress={() => showMode("lockChoice")} />
            ) : (
              <PanelActions
                confirmLabel="Lock folder"
                cancelLabel="Back"
                onConfirm={() => void doSetCredential()}
                onCancel={() => showMode("lockChoice")}
                loading={locking}
                cancelDisabled={busy}
              />
            )}
          </View>
        </>
      ) : null}

      {folder && mode === "removePassword" ? (
        <ThemedScrollView keyboardShouldPersistTaps="handled">
          <PanelHeader
            icon="lock-open-outline"
            iconColor={palette.danger}
            iconBackground={palette.dangerSoft}
            title="Remove lock?"
            subtitle="Anyone on this device can open it."
          />
          {(folder.lockType ?? "password") === "device" ? (
            error ? <Text variant="footnote" color="danger" align="center">{error}</Text> : null
          ) : (folder.lockType ?? "password") === "pattern" ? (
            <>
              <PatternInput
                value={pattern}
                onChange={(nodes) => {
                  setPattern(nodes);
                  if (error) setError("");
                }}
                onComplete={(nodes) => void removeWithFolderPassword(nodes)}
                error={Boolean(error)}
                disabled={removing}
              />
              {error ? <Text variant="footnote" color="danger" align="center">{error}</Text> : null}
            </>
          ) : (folder.lockType ?? "password") === "pin" ? (
            <View>
              {folder.pinLength ? null : (
                <Segmented
                  accessibilityLabel="PIN length"
                  options={[
                    { value: "4", label: "4 digits" },
                    { value: "6", label: "6 digits" },
                  ]}
                  value={String(pinLength) as "4" | "6"}
                  onChange={(value) => {
                    setPinLength(value === "6" ? 6 : 4);
                    setPassword("");
                    setError("");
                  }}
                />
              )}
              <OtpInput
                key={pinLength}
                purpose="pin"
                length={pinLength}
                value={password}
                onChange={(value) => {
                  setPassword(value);
                  if (error) setError("");
                }}
                onComplete={(code) => void removeWithFolderPassword(undefined, code)}
                status={removing ? "loading" : error ? "error" : "idle"}
                error={error || undefined}
                editable={!removing}
                style={folder.pinLength ? undefined : styles.pinBoxes}
              />
            </View>
          ) : (
            <AutofillForm><Input
              label="Folder password"
              disabled={busy}
              nativeID="folder-remove-password"
              required
              value={password}
              onChangeText={setPassword}
              placeholder="Folder password"
              secureTextEntry={!showPassword}
              {...localPasswordAutofillProps}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              error={error || undefined}
              onSubmitEditing={() => void removeWithFolderPassword()}
              rightAccessory={<EyeToggle visible={showPassword} onPress={() => setShowPassword((value) => !value)} />}
            /></AutofillForm>
          )}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Use account password"
            disabled={busy}
            hitSlop={8}
            onPress={() => showMode("removePasswordAccount")}
            style={styles.forgot}
          >
            <Text variant="labelLarge" color="accent">Use account password</Text>
          </PressableScale>
          <View style={sheetMenuStyles.stack}>
            {(folder.lockType ?? "password") === "pattern" || (folder.lockType ?? "password") === "pin" ? (
              <Button label="Cancel" variant="secondary" disabled={removing} onPress={() => showMode("menu")} />
            ) : (
              <PanelActions
                confirmLabel={(folder.lockType ?? "password") === "device" ? "Use device lock" : "Remove lock"}
                confirmVariant="danger"
                onConfirm={(folder.lockType ?? "password") === "device" ? removeWithDeviceLock : () => void removeWithFolderPassword()}
                onCancel={() => showMode("menu")}
                loading={removing}
                cancelDisabled={removing}
              />
            )}
          </View>
        </ThemedScrollView>
      ) : null}

      {folder && mode === "removePasswordAccount" ? (
        <ThemedScrollView keyboardShouldPersistTaps="handled">
          <PanelHeader
            icon="lock-open-outline"
            iconColor={palette.danger}
            iconBackground={palette.dangerSoft}
            title="Remove lock?"
          />
          <AutofillForm>
          <AccountAutofillIdentity nativeID="folder-account-username" />
          <Input
            label="Account password"
            disabled={busy}
            nativeID="folder-account-password"
            required
            value={accountPassword}
            onChangeText={setAccountPassword}
            placeholder="Your account password"
            secureTextEntry={!showAccountPassword}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            error={error || undefined}
            onSubmitEditing={submitAccountBypass}
            {...passwordAutofillProps("current-password")}
            rightAccessory={<EyeToggle visible={showAccountPassword} onPress={() => setShowAccountPassword((value) => !value)} />}
          />
          </AutofillForm>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={(folder.lockType ?? "password") === "device" ? "Use device lock" : "Use folder password"}
            disabled={busy}
            hitSlop={8}
            onPress={() => showMode("removePassword")}
            style={styles.forgot}
          >
            <Text variant="labelLarge" color="accent">
              {(folder.lockType ?? "password") === "device"
                ? "Use device lock"
                : (folder.lockType ?? "password") === "pattern"
                  ? "Use pattern"
                  : (folder.lockType ?? "password") === "pin"
                    ? "Use folder PIN"
                    : "Use folder password"}
            </Text>
          </PressableScale>
          <PanelActions
            confirmLabel="Remove lock"
            confirmVariant="danger"
            onConfirm={submitAccountBypass}
            onCancel={() => showMode("menu")}
            loading={removing}
            cancelDisabled={removing}
          />
        </ThemedScrollView>
      ) : null}

      {folder && mode === "icon" ? (
        <>
          <PanelHeader title="Choose an icon" />
          <View>
            <FolderIconGrid value={icon} onChange={setIcon} disabled={busy} />
            {error ? <Text variant="footnote" color="danger" style={styles.error}>{error}</Text> : null}
          </View>
          <PanelActions
            confirmLabel="Save icon"
            onConfirm={doUpdateIcon}
            onCancel={() => showMode("menu")}
            loading={update.isPending}
            cancelDisabled={busy}
            confirmDisabled={icon === folder.icon}
          />
        </>
      ) : null}
      </FloatingPanel>

      <FloatingPanel
        visible={visible && !!displayFolder && mode === "delete"}
        scrollBody={false}
        dismissible={!busy}
        onDismiss={() => showMode("menu")}
      >
        {displayFolder ? (
          <>
            <PanelHeader
              icon="trash-outline"
              iconColor={palette.danger}
              iconBackground={palette.dangerSoft}
              title={`Delete ${displayFolder.name}?`}
              subtitle={deleteAccessBlocked ? "Unlock this folder before deleting it." : deleteSubtitle}
            />
            {showKeepRow ? (
              <>
                <SettingRow
                  icon="bookmark-outline"
                  label="Keep bookmarks"
                  value={keepValue}
                  onPress={() => setKeepOpen((open) => !open)}
                  showChevron
                  chevronUp={keepOpen}
                  disabled={busy || deleteAccessBlocked}
                />
                <AnimatedDisclosure expanded={keepOpen && !deleteAccessBlocked} contentHeight={keepListHeight + spacing[4]}>
                  <ThemedFlatList
                    data={keepOptions.data ?? []}
                    initialNumToRender={6}
                    maxToRenderPerBatch={6}
                    windowSize={3}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                      <KeepBookmarkRow
                        item={item}
                        checked={keepIds.includes(item.id)}
                        disabled={busy}
                        onToggle={toggleKeep}
                      />
                    )}
                    style={[styles.keepList, { height: keepListHeight }]}
                    contentContainerStyle={{ gap: spacing[2], padding: spacing[2] }}
                    ListHeaderComponent={keepOptions.isError && (keepOptions.data?.length ?? 0) > 0 ? (
                      <View style={styles.keepStatus}>
                        <Text variant="footnote" color="danger" align="center">
                          {errorMessage(keepOptions.error)}
                        </Text>
                        <Button
                          label="Try again"
                          variant="secondary"
                          disabled={keepOptions.isFetching}
                          onPress={() => void keepOptions.refetch()}
                        />
                      </View>
                    ) : null}
                    ListEmptyComponent={
                      keepOptions.isPending ? (
                        <View style={styles.keepStatus}><Spinner /></View>
                      ) : keepOptions.isError ? (
                        <View style={styles.keepStatus}>
                          <Text variant="footnote" color="danger" align="center">
                            {errorMessage(keepOptions.error)}
                          </Text>
                          <Button
                            label="Try again"
                            variant="secondary"
                            disabled={keepOptions.isFetching}
                            onPress={() => void keepOptions.refetch()}
                          />
                        </View>
                      ) : (
                        <Text variant="footnote" color="tertiary" align="center" style={styles.keepStatus}>
                          No bookmarks in this folder.
                        </Text>
                      )
                    }
                  />
                </AnimatedDisclosure>
              </>
            ) : null}
            <PanelActions
              confirmLabel="Delete"
              confirmVariant="danger"
              onConfirm={doDelete}
              onCancel={() => showMode("menu")}
              cancelDisabled={busy}
              confirmDisabled={keepChoiceBlocked || deleteAccessBlocked}
            />
          </>
        ) : null}
      </FloatingPanel>
    </>
  );
}

/** One tickable row of the keep-on-delete picker. Mirrors the library row's
 * favicon treatment and the data screen's checkbox idiom. */
const KeepBookmarkRow = React.memo(function KeepBookmarkRow({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: BookmarkDto;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  const { palette, expressive } = useTheme();
  const domain = item.domain || domainFromUrl(item.url);
  const title = (item.title || domain).replace(/\s+/g, " ");
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  const [failedFavicon, setFailedFavicon] = React.useState(false);
  return (
    <ListPressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: disabled || undefined }}
      accessibilityLabel={title}
      disabled={disabled}
      onPress={() => onToggle(item.id)}
      style={[styles.keepRow, { borderRadius: expressive ? radius.xl : radius.lg, backgroundColor: palette.surfaceContainerLow }]}
    >
      <View style={styles.keepFaviconFrame}>
        {failedFavicon ? (
          <Ionicons
            name="globe-outline"
            size={20}
            color={palette.textTertiary}
            accessible={false}
            style={iconGlyphStyle(20)}
          />
        ) : (
          <Image
            source={{ uri: faviconUrl }}
            recyclingKey={item.id}
            style={styles.keepFavicon}
            contentFit="contain"
            cachePolicy="memory-disk"
            accessible={false}
            onError={() => setFailedFavicon(true)}
          />
        )}
      </View>
      <View style={styles.keepBody}>
        <Text variant="bodyLarge" numberOfLines={1} color="primary">{title}</Text>
        <Text variant="footnote" color="tertiary" numberOfLines={1}>{domain}</Text>
      </View>
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={22}
        color={checked ? palette.accent : palette.textFaint}
        accessible={false}
        style={iconGlyphStyle(22)}
      />
    </ListPressable>
  );
});

const styles = StyleSheet.create({
  error: { marginTop: spacing[8] },
  forgot: { alignSelf: "center", minHeight: 48, justifyContent: "center", paddingHorizontal: spacing[16], borderRadius: 24, marginTop: spacing[8] },
  confirmInput: { marginTop: spacing[12] },
  pinBoxes: { marginTop: spacing[12] },
  // The picker owns the panel's virtualized list (scrollBody={false}): let it
  // shrink inside the panel's bounded body instead of overflowing short dialogs.
  keepList: { flexShrink: 1, marginTop: spacing[4] },
  keepStatus: { paddingVertical: spacing[24], paddingHorizontal: spacing[16], gap: spacing[12], alignItems: "center" },
  keepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[14],
    minHeight: 64,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  keepFaviconFrame: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  keepFavicon: { width: 24, height: 24, borderRadius: radius.xs },
  keepBody: { flex: 1, minWidth: 0, gap: spacing[2] },
});
