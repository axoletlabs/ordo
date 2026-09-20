/**
 * Forgot password — step 2: enter the one-time code and choose a new password.
 */
import React, { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { ResetPasswordSchema } from "@ordo/shared";
import { AuthShell } from "../../src/components/auth/AuthShell";
import { OtpDeliveryHint } from "../../src/components/auth/OtpDeliveryHint";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { Text } from "../../src/components/ui/Text";
import { EyeToggle } from "../../src/components/ui/EyeToggle";
import { OtpInput, holdOtpSuccess, type OtpStatus } from "../../src/components/ui/OtpInput";
import { useForgotPassword, useResetPassword } from "../../src/hooks/use-auth-actions";
import { useServerInfo } from "../../src/hooks/queries";
import { errorMessage } from "../../src/lib/error-message";
import { otpEnterHelper, otpSentToast } from "../../src/lib/otp-copy";
import { haptics } from "../../src/lib/haptics";
import { spacing } from "../../src/theme/tokens";
import { toast } from "../../src/components/ui/toast-store";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const reset = useResetPassword();
  const resend = useForgotPassword();
  const { data: info } = useServerInfo();
  const smtpConfigured = info?.smtpConfigured;

  const email = (params.email ?? "").trim().toLowerCase();
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [formError, setFormError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("idle");
  const inFlight = useRef(false);

  const submit = async (code = token, fromOtp = false) => {
    if (inFlight.current || otpStatus === "success") return;
    setFormError("");
    setOtpError("");
    if (newPassword !== confirm) {
      if (fromOtp) return;
      setFormError("New passwords don't match.");
      return;
    }
    const parsed = ResetPasswordSchema.safeParse({
      email,
      token: code,
      newPassword,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue?.message || "Please check your input.";
      if (fromOtp && issue?.path[0] !== "token") return;
      if (issue?.path[0] === "token") setOtpError(message);
      else setFormError(message);
      return;
    }
    inFlight.current = true;
    setOtpStatus("loading");
    try {
      await reset.mutateAsync(parsed.data);
      setOtpStatus("success");
      haptics.success();
      toast.success("Password updated. Sign in with your new password.");
      await holdOtpSuccess();
      router.replace({
        pathname: "/(auth)/login",
        params: { identifier: email, nonce: String(Date.now()) },
      });
    } catch (e) {
      inFlight.current = false;
      setOtpStatus("error");
      haptics.error();
      setFormError(errorMessage(e));
    }
  };

  const onResend = async () => {
    if (!email) return;
    try {
      await resend.mutateAsync({ email });
      toast.success(otpSentToast(smtpConfigured, email));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const busy = otpStatus === "loading" || otpStatus === "success";

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={otpEnterHelper(smtpConfigured, email || undefined)}
      footer={
        <View style={styles.row}>
          <Link href="/(auth)/login" asChild replace>
            <Text variant="footnote" color="accent" style={styles.link}>Back to sign in</Text>
          </Link>
        </View>
      }
    >
      <OtpDeliveryHint smtpConfigured={smtpConfigured} />
      <OtpInput
        label="Reset code"
        value={token}
        onChange={(value) => {
          setToken(value);
          setOtpError("");
          setOtpStatus((s) => (s === "error" ? "idle" : s));
        }}
        status={otpStatus}
        error={otpError || undefined}
        onComplete={(code) => void submit(code, true)}
      />
      <View style={{ height: spacing[16] }} />
      <Input
        label="Email"
        value={email}
        onChangeText={() => {}}
        showSoftInputOnFocus={false}
        caretHidden
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        importantForAutofill="yes"
      />
      <View style={{ height: spacing[16] }} />
      <Input
        label="New password"
        value={newPassword}
        onChangeText={setNewPassword}
        placeholder="At least 8 characters"
        secureTextEntry={!showPwd}
        textContentType="newPassword"
        autoComplete="new-password"
        importantForAutofill="yes"
        passwordRules="minlength: 8;"
        rightAccessory={<EyeToggle visible={showPwd} onPress={() => setShowPwd((v) => !v)} />}
      />
      <View style={{ height: spacing[16] }} />
      <Input
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Re-enter your new password"
        secureTextEntry={!showPwd}
        textContentType="newPassword"
        autoComplete="new-password"
        importantForAutofill="yes"
        passwordRules="minlength: 8;"
        error={formError || undefined}
      />
      <View style={{ height: spacing[24] }} />
      <Button
        label="Reset password"
        block
        size="lg"
        onPress={() => void submit()}
        loading={busy}
      />
      <View style={{ height: spacing[12] }} />
      <Button
        label={resend.isPending ? "Sending…" : "Resend code"}
        variant="ghost"
        block
        onPress={onResend}
        loading={resend.isPending}
        disabled={!email || busy}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  link: { textDecorationLine: "underline" },
});
