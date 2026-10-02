/**
 * Verify an email change — step 2: enter the code sent to the new address.
 * Reached after submitting a change-email request.
 *
 * A nonce in the route params remounts this form on every send so a previous
 * OTP cannot come back in its loading/success lock.
 */
import React, { useCallback, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EMAIL_OTP } from "@ordo/shared";
import {
  SettingsForm,
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { Button } from "../../../src/components/ui/Button";
import { OtpInput, holdOtpSuccess, type OtpStatus } from "../../../src/components/ui/OtpInput";
import { useResendEmailChange, useVerifyEmailChange } from "../../../src/hooks/use-auth-actions";
import { useServerInfo } from "../../../src/hooks/queries";
import { errorMessage } from "../../../src/lib/error-message";
import { otpEnterHelper, otpSentToast } from "../../../src/lib/otp-copy";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { OtpDeliveryHint } from "../../../src/components/auth/OtpDeliveryHint";

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function VerifyEmailChangeScreen() {
  const params = useLocalSearchParams<{ email?: string; nonce?: string }>();
  const email = routeParam(params.email);
  const nonce = routeParam(params.nonce);
  return <VerifyEmailChangeForm key={`${email}:${nonce}`} email={email} />;
}

function VerifyEmailChangeForm({ email }: { email: string }) {
  const router = useRouter();
  const verify = useVerifyEmailChange();
  const resend = useResendEmailChange();
  const { data: info } = useServerInfo();
  const smtpConfigured = info?.smtpConfigured;

  const [token, setToken] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("idle");
  const inFlight = useRef(false);

  const resetOtp = useCallback(() => {
    setToken("");
    setOtpError("");
    setOtpStatus("idle");
    inFlight.current = false;
  }, []);

  const target = email || "your new address";

  const submit = async (code = token) => {
    if (inFlight.current || otpStatus === "success") return;
    setOtpError("");
    if (code.length !== EMAIL_OTP.LENGTH) {
      setOtpError("Enter your verification code.");
      return;
    }
    inFlight.current = true;
    setOtpStatus("loading");
    try {
      await verify.mutateAsync(code);
      setOtpStatus("success");
      haptics.success();
      toast.success("Email updated");
      await holdOtpSuccess();
      resetOtp();
      verify.reset();
      router.replace("/settings");
    } catch (e) {
      inFlight.current = false;
      setOtpStatus("error");
      haptics.error();
      setOtpError(errorMessage(e));
    }
  };

  const onResend = async () => {
    try {
      await resend.mutateAsync();
      resetOtp();
      toast.success(otpSentToast(smtpConfigured, target));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <SettingsPage title="Verify new email">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <SettingsGroup compact footer={otpEnterHelper(smtpConfigured, email || undefined)}>
            <SettingsForm>
              <OtpDeliveryHint smtpConfigured={smtpConfigured} compact />
              <OtpInput
                label="Verification code"
                value={token}
                onChange={(value) => {
                  setToken(value);
                  setOtpError("");
                  setOtpStatus((s) => (s === "error" ? "idle" : s));
                }}
                status={otpStatus}
                error={otpError || undefined}
                onComplete={(code) => void submit(code)}
              />
              <Button
                label="Verify"
                block
                size="md"
                onPress={() => void submit()}
                loading={otpStatus === "loading" || otpStatus === "success"}
              />
              <Button
                label={resend.isPending ? "Sending…" : "Resend code"}
                variant="ghost"
                block
                onPress={onResend}
                loading={resend.isPending}
                disabled={otpStatus === "loading" || otpStatus === "success"}
              />
            </SettingsForm>
          </SettingsGroup>
        </SettingsScrollView>
      </KeyboardAvoidingView>
    </SettingsPage>
  );
}
