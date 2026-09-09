/** Unlock UI for device, pattern, PIN, and password folder locks. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { TOKEN_TTL, type FolderLockType, type FolderPinLength } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { EyeToggle } from "../ui/EyeToggle";
import { Segmented } from "../ui/Segmented";
import { OtpInput } from "../ui/OtpInput";
import { PanelActions, sheetMenuStyles } from "../ui/SheetActionRow";
import { PatternInput } from "./PatternInput";
import { useUnlockFolder } from "../../hooks/use-folders";
import { getDeviceLockCredential } from "../../lib/device-folder-lock";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";

const UNLOCK_MINUTES = Math.round(TOKEN_TTL.FOLDER_MS / 60_000);

export interface UnlockFormProps {
  folderId: string;
  folderName?: string;
  lockType?: FolderLockType | null;
  pinLength?: FolderPinLength | null;
  onUnlocked?: () => void;
  /** When set, shows a ghost action that backs out of unlock (not the whole screen). */
  onCancel?: () => void;
  cancelLabel?: string;
  /**
   * Present the OS device-lock prompt as soon as this form is shown.
   * Off by default so locking a folder does not immediately ask to unlock it.
   */
  autoPromptDevice?: boolean;
}

export interface LockPromptProps extends UnlockFormProps {
  visible: boolean;
  onDismiss: () => void;
}

function unlockSubtitle(lockType: FolderLockType | null | undefined, digits: FolderPinLength): string {
  if (lockType === "device") return "Face ID, fingerprint, or device passcode.";
  if (lockType === "pattern") return "Draw your pattern.";
  if (lockType === "pin") return `${digits}-digit PIN.`;
  return "Enter the folder password.";
}

export function UnlockForm({
  folderId,
  folderName,
  lockType = "password",
  pinLength = null,
  onUnlocked,
  onCancel,
  cancelLabel = "Cancel",
  autoPromptDevice = false,
}: UnlockFormProps) {
  const { palette } = useTheme();
  const unlock = useUnlockFolder();
  const [focused, setFocused] = useState(true);
  const [password, setPassword] = useState("");
  const [pattern, setPattern] = useState<number[]>([]);
  const [pinDigits, setPinDigits] = useState<FolderPinLength>(4);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const deviceAttempted = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const digits: FolderPinLength = pinLength === 6 || pinLength === 4 ? pinLength : pinDigits;

  const reset = () => {
    setPassword("");
    setPattern([]);
    setShowPassword(false);
    setError("");
    setPinDigits(pinLength === 6 ? 6 : 4);
  };

  useEffect(() => {
    reset();
    deviceAttempted.current = false;
  }, [folderId, lockType, pinLength]);

  const finishUnlock = async (credential: string) => {
    await unlock.mutateAsync({ id: folderId, password: credential });
    haptics.success();
    reset();
    onUnlocked?.();
  };

  const submitPattern = async (nodes: number[]) => {
    if (unlock.isPending) return;
    if (nodes.length < 4) {
      setError("Connect at least 4 dots.");
      setPattern([]);
      return;
    }
    setError("");
    setPattern(nodes);
    try {
      await finishUnlock(nodes.join("-"));
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause, "That pattern is incorrect."));
      setPattern([]);
    }
  };

  const submitPin = async (code: string) => {
    if (unlock.isPending) return;
    if (code.length !== digits) {
      setError(`Enter your ${digits}-digit PIN.`);
      return;
    }
    setError("");
    setPassword(code);
    try {
      await finishUnlock(code);
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause, "That PIN is incorrect."));
      setPassword("");
    }
  };

  const submitPassword = async () => {
    setError("");
    if (!password) {
      setError("Enter the folder password.");
      return;
    }
    try {
      await finishUnlock(password);
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause, "That password is incorrect."));
    }
  };

  const submitDeviceLock = async () => {
    setError("");
    let credential: string | null;
    try {
      credential = await getDeviceLockCredential(folderId);
    } catch {
      setError("Device authentication was cancelled or unsuccessful.");
      return;
    }
    if (!credential) {
      setError(
        "This device no longer has the folder key. Remove the lock from the folder menu with your account password.",
      );
      return;
    }
    try {
      await finishUnlock(credential);
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause));
    }
  };

  useEffect(() => {
    if (!autoPromptDevice || !folderId || !focused || lockType !== "device" || deviceAttempted.current) return;
    if (Platform.OS === "web") return;
    deviceAttempted.current = true;
    void submitDeviceLock();
  }, [autoPromptDevice, focused, lockType, folderId]);

  const isPassword = lockType !== "device" && lockType !== "pattern" && lockType !== "pin";
  const knownPinLength = pinLength === 4 || pinLength === 6;
  const title = folderName ? `Unlock ${folderName}` : "Unlock folder";

  return (
    <View style={styles.form}>
      <PanelHeader
        icon={lockType === "device" ? "finger-print-outline" : "lock-closed-outline"}
        iconColor={palette.accent}
        iconBackground={palette.accentSoft}
        title={title}
        subtitle={unlockSubtitle(lockType, digits)}
      />
      {lockType === "device" ? (
        <Button
          label="Use device lock"
          block
          size="lg"
          onPress={submitDeviceLock}
          loading={unlock.isPending}
        />
      ) : lockType === "pattern" ? (
        <PatternInput
          value={pattern}
          onChange={(nodes) => {
            setPattern(nodes);
            if (error) setError("");
          }}
          onComplete={(nodes) => void submitPattern(nodes)}
          error={Boolean(error)}
          disabled={unlock.isPending}
        />
      ) : lockType === "pin" ? (
        <View>
          {knownPinLength ? null : (
            <Segmented
              options={[
                { value: "4", label: "4 digits" },
                { value: "6", label: "6 digits" },
              ]}
              value={String(pinDigits) as "4" | "6"}
              onChange={(value) => {
                setPinDigits(value === "6" ? 6 : 4);
                setPassword("");
                setError("");
              }}
            />
          )}
          <OtpInput
            key={digits}
            purpose="pin"
            length={digits}
            value={password}
            onChange={(value) => {
              setPassword(value);
              if (error) setError("");
            }}
            onComplete={(code) => void submitPin(code)}
            status={unlock.isPending ? "loading" : error ? "error" : "idle"}
            error={error || undefined}
            editable={!unlock.isPending}
            style={knownPinLength ? undefined : { marginTop: spacing[12] }}
          />
        </View>
      ) : (
        <Input
          label="Password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (error) setError("");
          }}
          placeholder="Folder password"
          secureTextEntry={!showPassword}
          autoFocus
          error={error || undefined}
          onSubmitEditing={() => void submitPassword()}
          autoCapitalize="none"
          autoCorrect={false}
          rightAccessory={<EyeToggle visible={showPassword} onPress={() => setShowPassword((value) => !value)} />}
        />
      )}
      {(lockType === "pattern" || lockType === "device") && error ? (
        <Text variant="footnote" color="danger" align="center" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {isPassword && onCancel ? (
        <PanelActions
          confirmLabel="Unlock"
          onConfirm={() => void submitPassword()}
          onCancel={onCancel}
          cancelLabel={cancelLabel}
          loading={unlock.isPending}
        />
      ) : isPassword ? (
        <Button label="Unlock" block onPress={() => void submitPassword()} loading={unlock.isPending} />
      ) : onCancel ? (
        <Button label={cancelLabel} variant="ghost" onPress={onCancel} style={sheetMenuStyles.cancel} />
      ) : null}
      <Text variant="caption" color="tertiary" align="center" style={styles.footnote}>
        Unlocked for {UNLOCK_MINUTES} minutes on this device.
      </Text>
    </View>
  );
}

/** Full-screen unlock: same form as the sheet, no second popup. */
export function UnlockScreen(props: UnlockFormProps) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.screenScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <UnlockForm {...props} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function LockPrompt({
  visible,
  folderId,
  folderName,
  lockType = "password",
  pinLength = null,
  onDismiss,
  onUnlocked,
}: LockPromptProps) {
  const [focused, setFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const close = () => onDismiss();
  const active = visible && focused && Boolean(folderId);

  return (
    <FloatingPanel visible={active} onDismiss={close}>
      {active ? (
        <UnlockForm
          folderId={folderId}
          folderName={folderName}
          lockType={lockType}
          pinLength={pinLength}
          autoPromptDevice
          onUnlocked={onUnlocked}
          onCancel={close}
        />
      ) : null}
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  form: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  error: {
    marginTop: spacing[8],
  },
  footnote: {
    marginTop: spacing[8],
  },
  screen: {
    flex: 1,
    width: "100%",
  },
  screenScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: spacing[24],
    paddingHorizontal: spacing[8],
  },
});
