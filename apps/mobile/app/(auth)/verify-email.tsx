/**
 * Email verification screen (only relevant when the server requires it).
 * Reached after signup if EMAIL_VERIFICATION_REQUIRED is on, or after login
 * when the account is still unverified.
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EMAIL_OTP } from "@ordo/shared";
import { AuthShell } from "../../src/components/auth/AuthShell";
import { OtpDeliveryHint } from "../../src/components/auth/OtpDeliveryHint";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { OtpInput, holdOtpSuccess, type OtpStatus } from "../../src/components/ui/OtpInput";
import { useVerifyEmail, useResendVerification } from "../../src/hooks/use-auth-actions";
import { useServerInfo } from "../../src/hooks/queries";
import { errorMessage } from "../../src/lib/error-message";
import { otpEnterHelper, otpSentToast, otpVerifySubtitle } from "../../src/lib/otp-copy";
import { haptics } from "../../src/lib/haptics";
import { useTheme } from "../../src/theme/ThemeProvider";
import { spacing } from "../../src/theme/tokens";
import { toast } from "../../src/components/ui/toast-store";

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function VerifyEmailScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; sent?: string }>();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const { data: info, isFetched: serverInfoFetched } = useServerInfo();
  const smtpConfigured = info?.smtpConfigured;
  const [email] = useState(routeParam(params.email));
  const [token, setToken] = useState("");
  const [emailError, setEmailError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("idle");
  const inFlight = useRef(false);
  const announcedSend = useRef(false);

  useEffect(() => {
    if (announcedSend.current || !serverInfoFetched) return;
    if (routeParam(params.sent) !== "1") return;
    const address = email.trim();
    if (!address) return;
    announcedSend.current = true;
    toast.success(otpSentToast(smtpConfigured, address));
  }, [email, params.sent, serverInfoFetched, smtpConfigured]);

  const editEmail = () => {
    haptics.selection();
    router.replace({
      pathname: "/(auth)/register",
      params: { focus: "email", email: email.trim() },
    });
  };

  const submit = async (code = token) => {
    if (inFlight.current || otpStatus === "success") return;
    setEmailError("");
    setOtpError("");
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setEmailError("Enter your email address.");
      return;
    }
    if (code.length !== EMAIL_OTP.LENGTH) {
      setOtpError("Enter your verification code.");
      return;
    }
    inFlight.current = true;
    setOtpStatus("loading");
    try {
      await verify.mutateAsync({ email: trimmedEmail, token: code });
      setOtpStatus("success");
      haptics.success();
      toast.success("Email verified. You can sign in now.");
      await holdOtpSuccess();
      router.replace("/(auth)/login");
    } catch (e) {
      inFlight.current = false;
      setOtpStatus("error");
      haptics.error();
      setOtpError(errorMessage(e));
    }
  };

  const onResend = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setEmailError("Enter your email address.");
      return;
    }
    try {
      await resend.mutateAsync({ email: trimmedEmail });
      toast.success(otpSentToast(smtpConfigured, trimmedEmail));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <AuthShell
      title="Verify your email"
      subtitle={
        email.trim()
          ? otpEnterHelper(smtpConfigured, email.trim())
          : otpVerifySubtitle(smtpConfigured)
      }
    >
      <OtpDeliveryHint smtpConfigured={smtpConfigured} />
      <Input
        label="Email"
        value={email}
        editable={false}
        placeholder="you@example.com"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoCapitalize="none"
        autoCorrect={false}
        error={emailError || undefined}
        rightAccessory={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit email"
            hitSlop={8}
            onPress={editEmail}
            style={styles.edit}
          >
            <Ionicons name="pencil-outline" size={18} color={palette.textTertiary} />
          </Pressable>
        }
      />
      <View style={{ height: spacing[16] }} />
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
        autoFocus={Boolean(params.email)}
        onComplete={(code) => void submit(code)}
      />
      <View style={{ height: spacing[24] }} />
      <Button
        label="Verify"
        block
        size="lg"
        onPress={() => void submit()}
        loading={otpStatus === "loading" || otpStatus === "success"}
      />
      <View style={{ height: spacing[12] }} />
      <Button
        label={resend.isPending ? "Sending…" : "Resend code"}
        variant="ghost"
        block
        onPress={() => void onResend()}
        loading={resend.isPending}
        disabled={!email.trim() || otpStatus === "loading" || otpStatus === "success"}
      />
      <View style={{ height: spacing[12] }} />
      <Button label="Back to sign in" variant="ghost" block onPress={() => router.replace("/(auth)/login")} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  edit: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
