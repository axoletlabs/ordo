import React, { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import {
  DELETE_ACCOUNT_CONFIRMATION,
  DeleteAccountSchema,
} from "@ordo/shared";
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
import { toast } from "../../../src/components/ui/toast-store";
import { MfaStepUpPanel } from "../../../src/components/auth/MfaStepUpPanel";
import { useDeleteAccount } from "../../../src/hooks/use-auth-actions";
import { errorMessage, isMfaRequiredError } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { spacing } from "../../../src/theme/tokens";

export default function DeleteAccountScreen() {
  const deleteAccount = useDeleteAccount();
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const [mfaOpen, setMfaOpen] = useState(false);

  const runDelete = async (mfaCode?: string) => {
    const parsed = DeleteAccountSchema.safeParse({
      currentPassword,
      confirmation,
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

  return (
    <SettingsPage title="Delete account">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <SettingsGroup compact>
            <SettingsForm style={styles.form}>
              <Input
                label="Password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="Enter your password"
                secureTextEntry={!showPassword}
                textContentType="password"
                rightAccessory={<EyeToggle visible={showPassword} onPress={() => setShowPassword((value) => !value)} />}
              />
              <Input
                label="Confirmation"
                value={confirmation}
                onChangeText={setConfirmation}
                placeholder={DELETE_ACCOUNT_CONFIRMATION}
                autoCapitalize="characters"
                autoCorrect={false}
                mono
                onSubmitEditing={submit}
              />
              <Button
                label="Delete account"
                variant="danger"
                block
                size="lg"
                loading={deleteAccount.isPending && !mfaOpen}
                disabled={!currentPassword || !confirmed}
                onPress={submit}
              />
              {formError ? (
                <Text variant="footnote" color="danger" align="center">
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

const styles = {
  form: { padding: spacing[16], gap: spacing[12] },
};
