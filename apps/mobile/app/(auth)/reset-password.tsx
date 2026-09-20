/**
 * Forgot password — enter the one-time code, then choose a new password.
 * The code and password fields are never on screen together: Autofill of the
 * reset code would otherwise rewrite the new-password boxes.
 */
import React, { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { EMAIL_OTP, ResetPasswordSchema } from "@ordo/shared";
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
import { passwordAutofillProps } from "../../src/lib/password-autofill";
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
  const [stage, setStage] = useState<"code" | "password">("code");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [formError, setFormError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("idle");
  const inFlight = useRef(false);

  const goToPassword = (code: string) => {
    setToken(code);
    setOtpError("");
    setOtpStatus("idle");
    setStage("password");
  };

  const goToCode = () => {
    setFormError("");
    setOtpStatus("idle");
    setStage("code");
  };

  const submit = async () => {
    if (inFlight.current || otpStatus === "success") return;
    setFormError("");
    setOtpError("");
    if (newPassword !== confirm) {
      setFormError("New passwords don't match.");
      return;
    }
    const parsed = ResetPasswordSchema.safeParse({
      email,
      token,
      newPassword,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue?.message || "Please check your input.";
      if (issue?.path[0] === "token") {
        setOtpError(message);
        setStage("code");
      } else {
        setFormError(message);
      }
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
      setOtpStatus("idle");
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
  const codeReady = token.replace(/\D/g, "").length === EMAIL_OTP.LENGTH;

  return (
    <AuthShell
      title={stage === "code" ? "Enter your reset code" : "Choose a new password"}
      subtitle={stage === "code" ? otpEnterHelper(smtpConfigured, email || undefined) : undefined}
      footer={
        <View style={styles.row}>
          <Link href="/(auth)/login" asChild replace>
            <Text variant="footnote" color="accent" style={styles.link}>Back to sign in</Text>
          </Link>
        </View>
      }
    >
      {stage === "code" ? (
        <>
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
            onComplete={goToPassword}
          />
          <View style={{ height: spacing[24] }} />
          <Button
            label="Continue"
            block
            size="lg"
            onPress={() => goToPassword(token)}
            disabled={!codeReady}
          />
          <View style={{ height: spacing[12] }} />
          <Button
            label={resend.isPending ? "Sending…" : "Resend code"}
            variant="ghost"
            block
            onPress={onResend}
            loading={resend.isPending}
            disabled={!email}
          />
        </>
      ) : (
        <>
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
            {...passwordAutofillProps("new-password")}
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
            {...passwordAutofillProps("new-password")}
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
            label="Use a different code"
            variant="ghost"
            block
            onPress={goToCode}
            disabled={busy}
          />
        </>
      )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  link: { textDecorationLine: "underline" },
});
