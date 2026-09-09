import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { APP_NAME, DEFAULT_FOLDER_ICON, type FolderDto, type FolderIcon, type FolderLockType, type FolderPinLength } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { PanelActions, sheetMenuStyles } from "../ui/SheetActionRow";
import { EyeToggle } from "../ui/EyeToggle";
import { PressableScale } from "../ui/PressableScale";
import { Segmented } from "../ui/Segmented";
import { OtpInput } from "../ui/OtpInput";
import { FolderIconPicker } from "./FolderIconPicker";
import { PatternInput } from "./PatternInput";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { toast } from "../ui/toast-store";
import { errorMessage } from "../../lib/error-message";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import { foldersApi } from "../../lib/api/folders";
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
  useRenameFolder,
  useUpdateFolder,
} from "../../hooks/use-folders";
import { useServerInfo } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { folderKey } from "../../hooks/use-selection";
import { useMenuHighlightStore } from "../../hooks/use-menu-highlight";

type Mode = "menu" | "rename" | "lockChoice" | "lockCredential" | "icon" | "delete" | "removePassword" | "removePasswordAccount";

export interface FolderActionsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  folder: FolderDto | null;
  anchor?: MenuAnchorRect | null;
  onDeleted?: (id: string) => void;
}

export function FolderActionsSheet({ visible, onDismiss, folder, anchor, onDeleted }: FolderActionsSheetProps) {
  const { palette } = useTheme();
  const serverInfo = useServerInfo();
  /** Older servers drop lockType and silently store every lock as a password. */
  const lockTypesSupported = serverInfo.data?.folderLockTypes === true;
  const rename = useRenameFolder();
  const update = useUpdateFolder();
  const del = useDeleteFolder();
  const clearToken = useFolderTokenStore((state) => state.clear);
  const [mode, setMode] = useState<Mode>("menu");
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
  const folderRef = React.useRef(folder);
  if (folder) folderRef.current = folder;
  const displayFolder = folder ?? folderRef.current;

  React.useEffect(() => {
    if (!visible || !folder) return;
    const key = folderKey(folder.id);
    useMenuHighlightStore.getState().set(key);
    return () => {
      const store = useMenuHighlightStore.getState();
      if (store.key === key) store.set(null);
    };
  }, [visible, folder]);

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

  const showMode = (nextMode: Mode) => {
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
    if (!folder) return;
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
    if (!folder) return;
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
    if (!folder) return;
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
    try {
      await foldersApi.setPassword(folder.id, { password: credential, lockType });
      patchFolderLock(folder.id, {
        protected: true,
        lockType,
        pinLength: lockType === "pin" ? pinLength : null,
      });
      clearToken(folder.id);
      invalidateBookmarks();
      haptics.success();
      toast.success("Folder locked");
      onDismiss();
    } catch (cause) {
      setError(errorMessage(cause));
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
        await deleteDeviceLockCredential(folder.id);
        throw cause;
      }
      patchFolderLock(folder.id, { protected: true, lockType: "device" });
      clearToken(folder.id);
      invalidateBookmarks();
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
    void deleteDeviceLockCredential(folder.id);
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
    if (!folder) return;
    haptics.medium();
    del.mutate(folder, {
      onDeleted: () => {
        onDeleted?.(folder.id);
        onDismiss();
      },
    });
  };

  const menuOpen = visible && !!displayFolder && (mode === "menu" || mode === "lockChoice" || mode === "delete");
  const dialogOpen = visible && !!displayFolder && mode !== "menu" && mode !== "lockChoice" && mode !== "delete";

  return (
    <>
      <ContextMenu visible={menuOpen} onDismiss={onDismiss} anchor={anchor ?? null}>
        {displayFolder && mode === "menu" ? (
          <>
            {error ? <Text variant="footnote" color="danger" style={styles.menuNote}>{error}</Text> : null}
            <ContextMenuItem icon={displayFolder.pinned ? "pin" : "pin-outline"} label={displayFolder.pinned ? "Unpin folder" : "Pin folder"} onPress={doTogglePinned} />
            <ContextMenuItem icon="happy-outline" label="Change icon" onPress={() => showMode("icon")} />
            <ContextMenuItem icon="create-outline" label="Rename" onPress={() => showMode("rename")} />
            {displayFolder.protected ? (
              <ContextMenuItem icon="lock-open-outline" label="Remove lock" onPress={() => showMode("removePassword")} />
            ) : (
              <ContextMenuItem icon="lock-closed-outline" label="Lock folder" onPress={() => showMode("lockChoice")} />
            )}
            <ContextMenuItem icon="trash-outline" label="Delete folder" tone="danger" onPress={() => showMode("delete")} />
          </>
        ) : null}
        {displayFolder && mode === "lockChoice" ? (
          <>
            <ContextMenuItem icon="chevron-back" label="Back" onPress={() => showMode("menu")} disabled={removing} />
            {error ? <Text variant="footnote" color="danger" style={styles.menuNote}>{error}</Text> : null}
            {serverInfo.data && !lockTypesSupported ? (
              <Text variant="footnote" color="tertiary" style={styles.menuNote}>
                Update your {APP_NAME} server to use pattern, PIN, and device locks.
              </Text>
            ) : null}
            {lockTypesSupported ? (
              <>
                <ContextMenuItem icon="finger-print-outline" label="Device lock" onPress={doSetDeviceLock} disabled={removing} />
                <ContextMenuItem icon="apps-outline" label="Pattern" onPress={() => { setLockType("pattern"); showMode("lockCredential"); }} />
                <ContextMenuItem icon="keypad-outline" label="PIN" onPress={() => { setLockType("pin"); showMode("lockCredential"); }} />
              </>
            ) : null}
            <ContextMenuItem icon="text-outline" label="Text password" onPress={() => { setLockType("password"); showMode("lockCredential"); }} />
          </>
        ) : null}
        {displayFolder && mode === "delete" ? (
          <>
            {error ? <Text variant="footnote" color="danger" style={styles.menuNote}>{error}</Text> : null}
            <ContextMenuItem
              icon="trash-outline"
              label="Delete folder"
              tone="danger"
              onPress={doDelete}
            />
            <ContextMenuItem label="Cancel" onPress={() => showMode("menu")} />
          </>
        ) : null}
      </ContextMenu>

      <FloatingPanel visible={dialogOpen} onDismiss={onDismiss}>
      {folder && mode === "rename" ? (
        <>
          <PanelHeader title="Rename folder" />
          <Input label="Name" value={name} onChangeText={setName} autoFocus error={error || undefined} onSubmitEditing={doRename} />
          <PanelActions
            confirmLabel="Save"
            onConfirm={doRename}
            onCancel={() => showMode("menu")}
            loading={rename.isPending}
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
              />
              {error ? <Text variant="footnote" color="danger" align="center">{error}</Text> : null}
            </>
          ) : lockType === "pin" ? (
            <View>
              {savedPin ? null : (
                <Segmented
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
                status={error ? "error" : "idle"}
                error={error || undefined}
                style={savedPin ? undefined : styles.pinBoxes}
              />
            </View>
          ) : (
            <>
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 4 characters"
                secureTextEntry={!showPassword}
                autoFocus
                error={error || undefined}
                autoCapitalize="none"
                autoCorrect={false}
                rightAccessory={<EyeToggle visible={showPassword} onPress={() => setShowPassword((value) => !value)} />}
              />
              <Input
                label="Confirm password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Enter password again"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                containerStyle={styles.confirmInput}
              />
            </>
          )}
          <View style={sheetMenuStyles.stack}>
            {lockType === "pattern" || lockType === "pin" ? (
              <Button label="Back" variant="ghost" onPress={() => showMode("lockChoice")} />
            ) : (
              <PanelActions
                confirmLabel="Lock folder"
                cancelLabel="Back"
                onConfirm={() => void doSetCredential()}
                onCancel={() => showMode("lockChoice")}
              />
            )}
          </View>
        </>
      ) : null}

      {folder && mode === "removePassword" ? (
        <ScrollView keyboardShouldPersistTaps="handled">
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
            <Input
              label="Folder password"
              value={password}
              onChangeText={setPassword}
              placeholder="Folder password"
              secureTextEntry={!showPassword}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              error={error || undefined}
              onSubmitEditing={() => void removeWithFolderPassword()}
              rightAccessory={<EyeToggle visible={showPassword} onPress={() => setShowPassword((value) => !value)} />}
            />
          )}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Use account password"
            hitSlop={8}
            onPress={() => showMode("removePasswordAccount")}
            style={styles.forgot}
          >
            <Text variant="footnote" color="accent">Use account password</Text>
          </PressableScale>
          <View style={sheetMenuStyles.stack}>
            {(folder.lockType ?? "password") === "pattern" || (folder.lockType ?? "password") === "pin" ? (
              <Button label="Cancel" variant="ghost" disabled={removing} onPress={() => showMode("menu")} />
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
        </ScrollView>
      ) : null}

      {folder && mode === "removePasswordAccount" ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          <PanelHeader
            icon="lock-open-outline"
            iconColor={palette.danger}
            iconBackground={palette.dangerSoft}
            title="Remove lock?"
            subtitle="Enter your account password."
          />
          <Input
            label="Account password"
            value={accountPassword}
            onChangeText={setAccountPassword}
            placeholder="Your account password"
            secureTextEntry={!showAccountPassword}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            error={error || undefined}
            onSubmitEditing={submitAccountBypass}
            textContentType="password"
            autoComplete="password"
            rightAccessory={<EyeToggle visible={showAccountPassword} onPress={() => setShowAccountPassword((value) => !value)} />}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={(folder.lockType ?? "password") === "device" ? "Use device lock" : "Use folder password"}
            hitSlop={8}
            onPress={() => showMode("removePassword")}
            style={styles.forgot}
          >
            <Text variant="footnote" color="accent">
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
        </ScrollView>
      ) : null}

      {folder && mode === "icon" ? (
        <>
          <PanelHeader title="Choose an icon" />
          <FolderIconPicker value={icon} onChange={setIcon} />
          {error ? <Text variant="footnote" color="danger" style={styles.error}>{error}</Text> : null}
          <PanelActions
            confirmLabel="Save icon"
            onConfirm={doUpdateIcon}
            onCancel={() => showMode("menu")}
            loading={update.isPending}
            confirmDisabled={icon === folder.icon}
          />
        </>
      ) : null}
      </FloatingPanel>
    </>
  );
}

const styles = StyleSheet.create({
  error: { marginTop: spacing[8] },
  menuNote: { marginHorizontal: spacing[12], marginVertical: spacing[6] },
  forgot: { alignSelf: "center", marginTop: spacing[8] },
  confirmInput: { marginTop: spacing[12] },
  pinBoxes: { marginTop: spacing[12] },
});
