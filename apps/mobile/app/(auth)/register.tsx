/**
 * Register screen. Respects server registration status (info.registrationEnabled).
 */
import React, { useCallback, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { AuthShell } from "../../src/components/auth/AuthShell";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { Text } from "../../src/components/ui/Text";
import { EyeToggle } from "../../src/components/ui/EyeToggle";
import { useRegister } from "../../src/hooks/use-auth-actions";
import { useServerInfo } from "../../src/hooks/queries";
import { errorMessage } from "../../src/lib/error-message";
import { haptics } from "../../src/lib/haptics";
import { useTheme } from "../../src/theme/ThemeProvider";
import { radius, spacing } from "../../src/theme/tokens";
import { RegisterSchema } from "@ordo/shared";

export default function RegisterScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const register = useRegister();
  const { data: info } = useServerInfo();
  const registrationEnabled = info?.registrationEnabled ?? true;

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [formError, setFormError] = useState("");

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        router.replace("/(auth)/login");
        return true;
      });
      return () => subscription.remove();
    }, [router]),
  );

  const submit = async () => {
    setFormError("");
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      return;
    }
    const parsed = RegisterSchema.safeParse({
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
      password,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Please check your input.");
      return;
    }
    try {
      await register.mutateAsync(parsed.data);
      haptics.success();
    } catch (e) {
      haptics.error();
      setFormError(errorMessage(e));
    }
  };

  return (
      <AuthShell
        title="Create your account"
        footer={
          <View style={styles.row}>
            <Text variant="footnote" color="secondary">Already have an account? </Text>
            <Link href="/(auth)/login" asChild replace>
              <Text variant="footnote" color="accent" style={styles.link}>Sign in</Text>
            </Link>
          </View>
        }
      >
      {!registrationEnabled ? (
        <View
          style={[
            styles.disabledCard,
            { backgroundColor: palette.surfaceSecondary, borderColor: palette.border },
          ]}
        >
          <Text variant="body">This server isn't accepting new sign-ups.</Text>
          <Text variant="footnote" color="secondary" style={{ marginTop: spacing[4] }}>
            Contact the server administrator for an account.
          </Text>
        </View>
      ) : (
        <>
          <Input
            label="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            textContentType="name"
            autoComplete="name"
            autoCapitalize="words"
            importantForAutofill="yes"
            error={formError || undefined}
          />
          <View style={{ height: spacing[16] }} />
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
          />
          <View style={{ height: spacing[16] }} />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry={!showPwd}
            textContentType="newPassword"
            autoComplete="new-password"
            importantForAutofill="yes"
            rightAccessory={<EyeToggle visible={showPwd} onPress={() => setShowPwd((v) => !v)} />}
          />
          <View style={{ height: spacing[16] }} />
          <Input
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter your password"
            secureTextEntry={!showPwd}
            textContentType="newPassword"
            autoComplete="new-password"
            importantForAutofill="yes"
          />

          <View style={{ height: spacing[24] }} />
          <Button label="Create account" block size="lg" onPress={submit} loading={register.isPending} />
        </>
      )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  link: { textDecorationLine: "underline" },
  disabledCard: { padding: spacing[16], borderRadius: radius.lg, borderWidth: 1 },
});
