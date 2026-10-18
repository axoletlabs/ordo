import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { DELETE_ACCOUNT_CONFIRMATION } from "@ordo/shared";
import { DeleteAccountSchema } from "@ordo/shared/schemas";
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
import { FormError } from "../../../src/components/ui/FormError";
import { toast } from "../../../src/components/ui/toast-store";
import { MfaStepUpPanel } from "../../../src/components/auth/MfaStepUpPanel";
import { useDeleteAccount } from "../../../src/hooks/use-auth-actions";
import { lockedSecretDisplay, passwordAutofillProps } from "../../../src/lib/password-autofill";
import { errorMessage, isMfaRequiredError } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { useCredentialLock } from "../../../src/hooks/use-credential-lock";
import { AccountAutofillIdentity } from "../../../src/components/auth/AccountAutofillIdentity";
export default function DeleteAccountScreen() {
  const deleteAccount = useDeleteAccount();
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const [mfaOpen, setMfaOpen] = useState(false);
  const credentialsLocked = useCredentialLock(mfaOpen);
  const submittedRef = useRef({ currentPassword: "", confirmation: "" });

  const runDelete = async (mfaCode?: string) => {
    const parsed = DeleteAccountSchema.safeParse({
      currentPassword: submittedRef.current.currentPassword,
      confirmation: submittedRef.current.confirmation,
      mfaCode,
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || "Please check your input.";
      setFormError(message);
      throw new Error(message);
    }
    await deleteAccount.mutateAsync(parsed.data);
    haptics.success();
    toast.success("Account deleted");
  };

  const submit = async () => {
    if (deleteAccount.isPending) return;
    setFormError("");
    const parsed = DeleteAccountSchema.safeParse({
      currentPassword,
      confirmation,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Please check your input.");
      return;
    }
    submittedRef.current = {
      currentPassword: parsed.data.currentPassword,
      confirmation: parsed.data.confirmation,
    };

    try {
      await runDelete();
    } catch (error) {
      if (isMfaRequiredError(error)) {
        setMfaOpen(true);
        return;
      }
      haptics.error();
      setFormError(errorMessage(error));
    }
  };

  const confirmed = confirmation === DELETE_ACCOUNT_CONFIRMATION;
  const passwordField = lockedSecretDisplay(currentPassword, credentialsLocked, showPassword);

  return (
    <SettingsPage title="Delete account">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <SettingsGroup compact>
            <SettingsForm key={credentialsLocked ? "credentials-locked" : "editable"}>
              <Text variant="bodyMedium" color="secondary">
                Deleting your account permanently removes your bookmarks, folders, tags, and account data. Export your library first if you want to keep it. This cannot be undone.
              </Text>
              <AccountAutofillIdentity nativeID="delete-account-username" locked={credentialsLocked} />
              <Input
                nativeID="delete-account-password"
                label="Password"
                required
                value={passwordField.value}
                onChangeText={setCurrentPassword}
                placeholder="Enter your password"
                secureTextEntry={passwordField.secureTextEntry}
                {...passwordAutofillProps("current-password", credentialsLocked)}
                rightAccessory={<EyeToggle visible={showPassword} onPress={() => setShowPassword((value) => !value)} />}
              />
              <Input
                nativeID="delete-account-confirmation"
                label="Confirmation"
                required
                value={confirmation}
                onChangeText={setConfirmation}
                placeholder={DELETE_ACCOUNT_CONFIRMATION}
                helper={`Type ${DELETE_ACCOUNT_CONFIRMATION} to confirm.`}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!credentialsLocked}
                mono
                onSubmitEditing={() => {
                  if (currentPassword && confirmed) void submit();
                }}
              />
              <Button
                label="Delete account"
                variant="danger"
                block
                size="md"
                loading={deleteAccount.isPending && !mfaOpen}
                disabled={!currentPassword || !confirmed}
                onPress={submit}
              />
              <FormError message={formError} />
            </SettingsForm>
          </SettingsGroup>
        </SettingsScrollView>
      </KeyboardAvoidingView>

      <MfaStepUpPanel
        visible={mfaOpen}
        onDismiss={() => setMfaOpen(false)}
        title="Delete account?"
        description="Enter an authenticator or backup code. This can't be undone."
        confirmLabel="Delete account"
        confirmVariant="danger"
        onConfirm={async (code) => {
          await runDelete(code);
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
