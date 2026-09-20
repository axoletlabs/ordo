import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import {
  SettingsForm,
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { Input } from "../../../src/components/ui/Input";
import { Button } from "../../../src/components/ui/Button";
import { EyeToggle } from "../../../src/components/ui/EyeToggle";
import { Text } from "../../../src/components/ui/Text";
import { useChangePassword } from "../../../src/hooks/use-auth-actions";
import { errorMessage, isMfaRequiredError } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { spacing } from "../../../src/theme/tokens";
import { ChangePasswordSchema } from "@ordo/shared";
import { MfaStepUpPanel } from "../../../src/components/auth/MfaStepUpPanel";
import { lockedSecretDisplay, passwordAutofillProps } from "../../../src/lib/password-autofill";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [formError, setFormError] = useState("");
  const [mfaOpen, setMfaOpen] = useState(false);
  const submittedRef = useRef({ currentPassword: "", newPassword: "" });

  const runChange = async (mfaCode?: string) => {
    const parsed = ChangePasswordSchema.safeParse({
      currentPassword: submittedRef.current.currentPassword,
      newPassword: submittedRef.current.newPassword,
      mfaCode,
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || "Please check your input.";
      setFormError(message);
      throw new Error(message);
    }
    await changePassword.mutateAsync(parsed.data);
    haptics.success();
    toast.success("Password changed. All devices were signed out.");
    router.back();
  };

  const submit = async () => {
    setFormError("");
    if (newPassword !== confirm) {
      setFormError("New passwords don't match.");
      return;
    }
    const parsed = ChangePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Please check your input.");
      return;
    }
    submittedRef.current = {
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    };
    try {
      await runChange();
    } catch (e) {
      if (isMfaRequiredError(e)) {
        setMfaOpen(true);
        return;
      }
      haptics.error();
      setFormError(errorMessage(e));
    }
  };

  const currentField = lockedSecretDisplay(currentPassword, mfaOpen, showPwd);
  const newField = lockedSecretDisplay(newPassword, mfaOpen, showPwd);
  const confirmField = lockedSecretDisplay(confirm, mfaOpen, showPwd);

  return (
    <SettingsPage title="Password">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <SettingsGroup compact>
            <SettingsForm key={mfaOpen ? "mfa-locked" : "editable"} style={styles.form}>
              <Input
                label="Current password"
                value={currentField.value}
                onChangeText={setCurrentPassword}
                placeholder="Enter your current password"
                secureTextEntry={currentField.secureTextEntry}
                {...passwordAutofillProps("current-password", mfaOpen)}
                rightAccessory={<EyeToggle visible={showPwd} onPress={() => setShowPwd((v) => !v)} />}
              />
              <Input
                label="New password"
                value={newField.value}
                onChangeText={setNewPassword}
                placeholder="At least 8 characters"
                secureTextEntry={newField.secureTextEntry}
                {...passwordAutofillProps("new-password", mfaOpen)}
              />
              <Input
                label="Confirm new password"
                value={confirmField.value}
                onChangeText={setConfirm}
                placeholder="Re-enter your new password"
                secureTextEntry={confirmField.secureTextEntry}
                {...passwordAutofillProps("new-password", mfaOpen)}
              />

              <Button
                label="Change password"
                block
                size="lg"
                onPress={submit}
                loading={changePassword.isPending && !mfaOpen}
              />
              {formError ? (
                <Text variant="footnote" color="danger" style={styles.formError}>
                  {formError}
                </Text>
              ) : null}
            </SettingsForm>
          </SettingsGroup>
        </SettingsScrollView>
      </KeyboardAvoidingView>

      <MfaStepUpPanel
        visible={mfaOpen}
        onDismiss={() => setMfaOpen(false)}
        title="Confirm password change"
        description="Enter an authenticator or backup code. Other devices will be signed out."
        confirmLabel="Change password"
        onConfirm={async (code) => {
          await runChange(code);
          setMfaOpen(false);
        }}
        onUnhandledError={(err) => {
          setMfaOpen(false);
          haptics.error();
          setFormError(errorMessage(err));
        }}
      />
    </SettingsPage>
  );
}

const styles = {
  form: { padding: spacing[16], gap: spacing[12] },
  formError: { textAlign: "center" as const },
};
