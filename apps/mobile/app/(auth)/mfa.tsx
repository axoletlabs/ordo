/**
 * Second step of login when TOTP is enabled.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthShell } from "../../src/components/auth/AuthShell";
import { Button } from "../../src/components/ui/Button";
import { Text } from "../../src/components/ui/Text";
import { OtpInput, type OtpStatus } from "../../src/components/ui/OtpInput";
import { OtpDeliveryHint } from "../../src/components/auth/OtpDeliveryHint";
import { useLoginMfa, useLoginMfaEmailVerify } from "../../src/hooks/use-auth-actions";
import { useServerInfo } from "../../src/hooks/queries";
import { authApi } from "../../src/lib/api/auth";
import { errorMessage } from "../../src/lib/error-message";
import { haptics } from "../../src/lib/haptics";
import { toast } from "../../src/components/ui/toast-store";
import { spacing } from "../../src/theme/tokens";

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default function LoginMfaScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    challengeToken?: string;
    email?: string;
    emailRecovery?: string;
  }>();
  const challengeToken = param(params.challengeToken);
  const emailRecovery = param(params.emailRecovery) === "1";
  const { data: info } = useServerInfo();
  const loginMfa = useLoginMfa();
  const verifyEmail = useLoginMfaEmailVerify();

  const [mode, setMode] = useState<"totp" | "backup" | "email">("totp");
  const [totp, setTotp] = useState("");
  const [backup, setBackup] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("idle");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const submitCode = async (code: string) => {
    setError("");
    setOtpStatus("loading");
    try {
      await loginMfa.mutateAsync({ challengeToken, code });
      setOtpStatus("success");
      haptics.success();
    } catch (e) {
      setOtpStatus("error");
      haptics.error();
      setError(errorMessage(e));
    }
  };

  const requestEmail = async () => {
    setError("");
    setSending(true);
    try {
      await authApi.loginMfaEmail({ challengeToken });
      setMode("email");
      toast.success(info?.smtpConfigured === false ? "Code printed in the server console" : "Sign-in code sent");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const submitEmail = async (token: string) => {
    setError("");
    setOtpStatus("loading");
    try {
      await verifyEmail.mutateAsync({ challengeToken, token });
      setOtpStatus("success");
      haptics.success();
      toast.success("Signed in. Your authenticator is still on.");
    } catch (e) {
      setOtpStatus("error");
      haptics.error();
      setError(errorMessage(e));
    }
  };

  return (
    <AuthShell title="Check your authenticator">
      {mode === "totp" ? (
        <>
          <OtpInput
            value={totp}
            onChange={(next) => {
              setTotp(next);
              if (error) setError("");
              if (otpStatus === "error") setOtpStatus("idle");
            }}
            onComplete={submitCode}
            status={otpStatus}
            error={error || undefined}
            label="Authenticator code"
          />
          <View style={{ height: spacing[16] }} />
          <Button
            label="Use a backup code"
            variant="ghost"
            onPress={() => {
              setError("");
              setOtpStatus("idle");
              setMode("backup");
            }}
          />
          {emailRecovery ? (
            <Button
              label="Email me a sign-in code"
              variant="ghost"
              loading={sending}
              onPress={requestEmail}
            />
          ) : null}
          <Button label="Back to sign in" variant="ghost" onPress={() => router.back()} />
        </>
      ) : null}

      {mode === "backup" ? (
        <>
          <OtpInput
            kind="backup"
            value={backup}
            onChange={(next) => {
              setBackup(next);
              if (error) setError("");
              if (otpStatus === "error") setOtpStatus("idle");
            }}
            onComplete={submitCode}
            status={otpStatus}
            error={error || undefined}
            label="Backup code"
          />
          <View style={{ height: spacing[16] }} />
          <Button
            label="Use an authenticator code"
            variant="ghost"
            onPress={() => {
              setError("");
              setOtpStatus("idle");
              setMode("totp");
            }}
          />
        </>
      ) : null}

      {mode === "email" ? (
        <>
          <OtpDeliveryHint smtpConfigured={info?.smtpConfigured} />
          <OtpInput
            value={emailCode}
            onChange={setEmailCode}
            onComplete={submitEmail}
            status={otpStatus}
            error={error || undefined}
            label="Email sign-in code"
          />
          <View style={{ height: spacing[16] }} />
          <Text variant="footnote" color="secondary">
            This signs you in once. Your authenticator stays on.
          </Text>
          <Button
            label="Use an authenticator code"
            variant="ghost"
            onPress={() => {
              setError("");
              setOtpStatus("idle");
              setMode("totp");
            }}
          />
        </>
      ) : null}
    </AuthShell>
  );
}
