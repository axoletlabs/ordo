/**
 * Forgot password — step 1: enter the account email. Always succeeds so
 * we never reveal whether the address is registered.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { ForgotPasswordSchema } from "@ordo/shared";
import { AuthShell } from "../../src/components/auth/AuthShell";
import { OtpDeliveryHint } from "../../src/components/auth/OtpDeliveryHint";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { Text } from "../../src/components/ui/Text";
import { useForgotPassword } from "../../src/hooks/use-auth-actions";
import { useServerInfo } from "../../src/hooks/queries";
import { errorMessage } from "../../src/lib/error-message";
import { otpRequestFooter, otpSentToast } from "../../src/lib/otp-copy";
import { haptics } from "../../src/lib/haptics";
import { spacing } from "../../src/theme/tokens";
import { toast } from "../../src/components/ui/toast-store";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const forgot = useForgotPassword();
  const { data: info } = useServerInfo();
  const smtpConfigured = info?.smtpConfigured;

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");

  const submit = async () => {
    setFormError("");
    const parsed = ForgotPasswordSchema.safeParse({ email: email.trim().toLowerCase() });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Enter a valid email.");
      return;
    }
    try {
      await forgot.mutateAsync(parsed.data);
      haptics.success();
      toast.success(otpSentToast(smtpConfigured, parsed.data.email));
      router.push({ pathname: "/(auth)/reset-password", params: { email: parsed.data.email } });
    } catch (e) {
      haptics.error();
      setFormError(errorMessage(e));
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle={otpRequestFooter(smtpConfigured, "reset")}
      footer={
        <View style={styles.row}>
          <Text variant="footnote" color="secondary">Remembered it? </Text>
          <Link href="/(auth)/login" asChild replace>
            <Text variant="footnote" color="accent" style={styles.link}>Sign in</Text>
          </Link>
        </View>
      }
    >
      <OtpDeliveryHint smtpConfigured={smtpConfigured} />
      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoCapitalize="none"
        autoCorrect={false}
        error={formError || undefined}
      />
      <View style={{ height: spacing[24] }} />
      <Button label="Send reset code" block size="md" onPress={submit} loading={forgot.isPending} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  link: { textDecorationLine: "underline" },
});
