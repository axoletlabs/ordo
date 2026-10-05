/**
 * Register screen. Respects server registration status (info.registrationEnabled).
 */
import React, { useCallback, useRef, useState } from "react";
import { BackHandler, Linking, Platform, StyleSheet, View, type TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { AuthLink } from "../../src/components/auth/AuthLink";
import { FormError } from "../../src/components/ui/FormError";
import { AuthShell } from "../../src/components/auth/AuthShell";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { CheckLine } from "../../src/components/ui/CheckLine";
import { Text } from "../../src/components/ui/Text";
import { EyeToggle } from "../../src/components/ui/EyeToggle";
import { useRegister } from "../../src/hooks/use-auth-actions";
import { useServerInfo } from "../../src/hooks/queries";
import { useSettingsStore } from "../../src/store/settings";
import { CLOUD_PRIVACY_URL, CLOUD_TERMS_URL, isCloudServerUrl } from "../../src/lib/hosting";
import { errorMessage } from "../../src/lib/error-message";
import { haptics } from "../../src/lib/haptics";
import { useTheme } from "../../src/theme/ThemeProvider";
import { radius, spacing } from "../../src/theme/tokens";
import { RegisterSchema, isPendingEmailVerificationResponse } from "@ordo/shared";
import { readSignupDraft, saveSignupDraft } from "../../src/lib/signup-draft";

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

const AGE_CONFIRM_LABEL = "I am 13 or older and agree to the Terms and Privacy Policy.";
const AGE_CONFIRM_ERROR = "Please confirm you are 13 or older.";

export default function RegisterScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string; email?: string }>();
  const focusEmail = routeParam(params.focus) === "email";
  const paramEmail = routeParam(params.email);
  const register = useRegister();
  const { data: info } = useServerInfo();
  const registrationEnabled = info?.registrationEnabled ?? true;
  const isCloud = isCloudServerUrl(useSettingsStore((s) => s.serverUrl));

  const returning = focusEmail ? readSignupDraft() : null;
  const [displayName, setDisplayName] = useState(returning?.displayName ?? "");
  const [email, setEmail] = useState(paramEmail || returning?.email || "");
  const [password, setPassword] = useState(returning?.password ?? "");
  const [confirm, setConfirm] = useState(returning?.confirm ?? "");
  const [showPwd, setShowPwd] = useState(false);
  const [atLeast13, setAtLeast13] = useState(returning?.atLeast13 ?? false);
  const [formError, setFormError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const inFlight = useRef(false);
  const skipAgeToggle = useRef(false);
  const emailRef = useRef<TextInput>(null);
  const markLegalOpen = () => {
    skipAgeToggle.current = true;
    setTimeout(() => {
      skipAgeToggle.current = false;
    }, 300);
  };

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        router.replace("/(auth)/login");
        return true;
      });
      return () => subscription.remove();
    }, [router]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!focusEmail) return;
      const handle = requestAnimationFrame(() => emailRef.current?.focus());
      return () => cancelAnimationFrame(handle);
    }, [focusEmail]),
  );

  const submit = async () => {
    if (inFlight.current) return;
    setFormError("");
    setErrorField(null);
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      setErrorField("confirm");
      return;
    }
    if (isCloud && !atLeast13) {
      setFormError(AGE_CONFIRM_ERROR);
      setErrorField("age");
      return;
    }
    const parsed = RegisterSchema.safeParse({
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
      password,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Please check your input.");
      setErrorField(String(parsed.error.issues[0]?.path[0] ?? ""));
      return;
    }
    inFlight.current = true;
    try {
      const result = await register.mutateAsync(parsed.data);
      haptics.success();
      if (isPendingEmailVerificationResponse(result)) {
        saveSignupDraft({
          displayName: displayName.trim(),
          email: parsed.data.email,
          password,
          confirm,
          atLeast13,
        });
        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: parsed.data.email, sent: "1" },
        });
      }
    } catch (e) {
      haptics.error();
      setFormError(errorMessage(e));
    } finally {
      inFlight.current = false;
    }
  };

  return (
      <AuthShell
        title="Create your account"
        footer={
          <View style={styles.row}>
            <Text variant="footnote" color="secondary">Already have an account? </Text>
            <AuthLink href="/(auth)/login" label="Sign in" replace />
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
            error={errorField === "displayName" ? formError : undefined}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <View style={{ height: spacing[16] }} />
          <Input
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            autoFocus={focusEmail}
            error={errorField === "email" ? formError : undefined}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <View style={{ height: spacing[16] }} />
          <Input
            label="Password"
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            helper="Use at least 8 characters."
            error={errorField === "password" ? formError : undefined}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmRef.current?.focus()}
            secureTextEntry={!showPwd}
            textContentType="newPassword"
            autoComplete="new-password"
            importantForAutofill="yes"
            rightAccessory={<EyeToggle visible={showPwd} onPress={() => setShowPwd((v) => !v)} />}
          />
          <View style={{ height: spacing[16] }} />
          <Input
            label="Confirm password"
            ref={confirmRef}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter your password"
            secureTextEntry={!showPwd}
            textContentType="newPassword"
            autoComplete="new-password"
            importantForAutofill="yes"
            error={errorField === "confirm" ? formError : undefined}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />

          {isCloud ? (
            <>
              <View style={{ height: spacing[16] }} />
              <CheckLine
                checked={atLeast13}
                label={AGE_CONFIRM_LABEL}
                onPress={() => {
                  if (skipAgeToggle.current) {
                    skipAgeToggle.current = false;
                    return;
                  }
                  setAtLeast13((v) => !v);
                  setFormError("");
                }}
              >
                I am 13 or older and agree to the{" "}
                <LegalLink label="Terms" url={CLOUD_TERMS_URL} onOpen={markLegalOpen} />
                {" "}and{" "}
                <LegalLink label="Privacy Policy" url={CLOUD_PRIVACY_URL} onOpen={markLegalOpen} />
                .
              </CheckLine>
              {formError === AGE_CONFIRM_ERROR ? (
                <Text variant="bodySmall" color="danger" accessibilityLiveRegion="polite" style={{ marginTop: spacing[8] }}>
                  {formError}
                </Text>
              ) : null}
            </>
          ) : null}

          <View style={{ height: spacing[24] }} />
          <FormError message={errorField ? undefined : formError} />
          <Button label="Create account" block size="md" onPress={submit} loading={register.isPending} />
        </>
      )}
    </AuthShell>
  );
}

function LegalLink({
  label,
  url,
  onOpen,
}: {
  label: string;
  url: string;
  onOpen: () => void;
}) {
  return (
    <Text
      variant="footnote"
      color="accent"
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={(event) => {
        event.stopPropagation();
        onOpen();
        haptics.light();
        Linking.openURL(url).catch(() => {});
      }}
      style={styles.link}
    >
      {label.replaceAll(" ", "\u00a0")}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center" },
  link: { textDecorationLine: "underline", includeFontPadding: false },
  disabledCard: { padding: spacing[16], borderRadius: radius.lg, borderWidth: 1 },
});
