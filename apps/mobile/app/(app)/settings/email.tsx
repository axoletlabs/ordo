/**
 * Change email — step 1: confirm current password + enter the new email.
 * On success the server sends a verification code to the new address and we
 * navigate to the verify screen.
 *
 * Settings routes live in a tab navigator that keeps screens mounted. The form
 * is keyed by the signed-in email so a completed change cannot leave the
 * previous address and password sitting in the next visit.
 */
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
import { useRequestEmailChange } from "../../../src/hooks/use-auth-actions";
import { useAuthStore } from "../../../src/store/auth";
import { useServerInfo } from "../../../src/hooks/queries";
import { errorMessage, isMfaRequiredError } from "../../../src/lib/error-message";
import { otpRequestFooter, otpSentToast } from "../../../src/lib/otp-copy";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { spacing } from "../../../src/theme/tokens";
import { ChangeEmailSchema } from "@ordo/shared";
import { OtpDeliveryHint } from "../../../src/components/auth/OtpDeliveryHint";
import { MfaStepUpPanel } from "../../../src/components/auth/MfaStepUpPanel";
import { lockedSecretDisplay, passwordAutofillProps } from "../../../src/lib/password-autofill";

export default function ChangeEmailScreen() {
  const email = useAuthStore((s) => s.user?.email ?? "");
  return <ChangeEmailForm key={email} />;
}

function ChangeEmailForm() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const requestEmailChange = useRequestEmailChange();
  const { data: info } = useServerInfo();
  const smtpConfigured = info?.smtpConfigured;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [formError, setFormError] = useState("");
  const [mfaOpen, setMfaOpen] = useState(false);
  const submittedRef = useRef({ currentPassword: "", newEmail: "" });

  const parsedBody = () =>
    ChangeEmailSchema.safeParse({
      currentPassword,
      newEmail: newEmail.trim().toLowerCase(),
    });

  const runChange = async (mfaCode?: string) => {
    const parsed = ChangeEmailSchema.safeParse(submittedRef.current);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || "Please check your input.";
      setFormError(message);
      throw new Error(message);
    }
    await requestEmailChange.mutateAsync({ ...parsed.data, mfaCode });
    haptics.success();
    toast.success(otpSentToast(smtpConfigured, parsed.data.newEmail));
    setNewEmail("");
    setCurrentPassword("");
    setShowPwd(false);
    setFormError("");
    requestEmailChange.reset();
    router.replace({
      pathname: "/settings/verify-email",
      params: { email: parsed.data.newEmail, nonce: String(Date.now()) },
    });
  };

  const submit = async () => {
    setFormError("");
    const parsed = parsedBody();
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Please check your input.");
      return;
    }
    submittedRef.current = parsed.data;
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

  const passwordField = lockedSecretDisplay(currentPassword, mfaOpen, showPwd);

  return (
    <SettingsPage title="Email">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <SettingsGroup compact footer={otpRequestFooter(smtpConfigured, "email-change")}>
            <SettingsForm key={mfaOpen ? "mfa-locked" : "editable"} style={styles.form}>
              <OtpDeliveryHint smtpConfigured={smtpConfigured} compact />
              <Input
                label="Current email"
                value={user?.email ?? ""}
                onChangeText={() => {}}
                editable={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
              />
              <Input
                label="New email"
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                autoCapitalize="none"
              />
              <Input
                label="Current password"
                value={passwordField.value}
                onChangeText={setCurrentPassword}
                placeholder="Enter your current password"
                secureTextEntry={passwordField.secureTextEntry}
                {...passwordAutofillProps("password", mfaOpen)}
                error={formError || undefined}
                rightAccessory={<EyeToggle visible={showPwd} onPress={() => setShowPwd((v) => !v)} />}
              />

              <Button
                label="Send code"
                block
                size="lg"
                onPress={submit}
                loading={requestEmailChange.isPending && !mfaOpen}
              />
            </SettingsForm>
          </SettingsGroup>
        </SettingsScrollView>
      </KeyboardAvoidingView>

      <MfaStepUpPanel
        visible={mfaOpen}
        onDismiss={() => setMfaOpen(false)}
        title="Confirm email change"
        description="Enter an authenticator or backup code to send the verification code."
        confirmLabel="Send code"
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
};
