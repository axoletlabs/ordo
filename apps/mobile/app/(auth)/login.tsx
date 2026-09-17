/**
 * Login screen. Cloud is the default; self-host is a secondary opt-in.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { AuthShell } from "../../src/components/auth/AuthShell";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { Text } from "../../src/components/ui/Text";
import { PressableScale } from "../../src/components/ui/PressableScale";
import { ConfirmDialog } from "../../src/components/ui/ConfirmDialog";
import { ServerConnectSheet } from "../../src/components/auth/ServerConnectSheet";
import { SelfHostFlow } from "../../src/components/settings/SelfHostFlow";
import { EyeToggle } from "../../src/components/ui/EyeToggle";
import { useSettingsStore } from "../../src/store/settings";
import { useLogin } from "../../src/hooks/use-auth-actions";
import { useCommitServerSwitch } from "../../src/hooks/use-commit-server-switch";
import { errorMessage } from "../../src/lib/error-message";
import { ApiClientError } from "../../src/lib/api/client";
import { CLOUD_SERVER_URL, hostingModeOf } from "../../src/lib/hosting";
import { hostOf } from "../../src/lib/instance-name";
import { haptics } from "../../src/lib/haptics";
import { spacing } from "../../src/theme/tokens";
import { ErrorCode, LoginSchema, isMfaRequiredResponse } from "@ordo/shared";

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function LoginScreen() {
  const params = useLocalSearchParams<{ identifier?: string; nonce?: string }>();
  const identifier = routeParam(params.identifier);
  const nonce = routeParam(params.nonce);
  return <LoginForm key={`${nonce}:${identifier}`} initialIdentifier={identifier} />;
}

function LoginForm({ initialIdentifier }: { initialIdentifier: string }) {
  const router = useRouter();
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const login = useLogin();
  const { commit, busy } = useCommitServerSwitch();
  const selfHosted = hostingModeOf(serverUrl) === "selfHosted";

  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showSelfHost, setShowSelfHost] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [confirmCloud, setConfirmCloud] = useState(false);
  const [formError, setFormError] = useState("");

  const submit = async () => {
    setFormError("");
    const parsed = LoginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Please check your input.");
      return;
    }
    try {
      const result = await login.mutateAsync(parsed.data);
      if (isMfaRequiredResponse(result)) {
        haptics.light();
        router.push({
          pathname: "/(auth)/mfa",
          params: {
            challengeToken: result.challengeToken,
            email: parsed.data.identifier,
            emailRecovery: result.emailRecoveryAvailable ? "1" : "0",
          },
        });
        return;
      }
      haptics.success();
    } catch (e) {
      haptics.error();
      if (e instanceof ApiClientError && e.code === ErrorCode.EMAIL_NOT_VERIFIED) {
        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: parsed.data.identifier.trim().toLowerCase() },
        });
        return;
      }
      setFormError(errorMessage(e));
    }
  };

  return (
    <>
      <AuthShell
        title="Welcome back"
        footer={
          <View style={styles.row}>
            <Text variant="footnote" color="secondary">No account yet? </Text>
            <Link href="/(auth)/register" asChild replace>
              <Text variant="footnote" color="accent" style={styles.link}>Create one</Text>
            </Link>
          </View>
        }
      >
        <Input
          label="Email"
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="you@example.com"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          importantForAutofill="yes"
          error={formError || undefined}
        />
        <View style={{ height: spacing[16] }} />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry={!showPwd}
          textContentType="password"
          autoComplete="current-password"
          importantForAutofill="yes"
          rightAccessory={<EyeToggle visible={showPwd} onPress={() => setShowPwd((v) => !v)} />}
        />
        <View style={styles.forgotRow}>
          <Link href="/(auth)/forgot-password" asChild>
            <Text variant="footnote" color="accent" style={styles.link}>Forgot password?</Text>
          </Link>
        </View>

        <View style={{ height: spacing[24] }} />
        <Button label="Sign in" block size="lg" onPress={submit} loading={login.isPending} />

        {selfHosted ? (
          <View style={styles.hosting}>
            <Text variant="footnote" color="tertiary" align="center">
              Using <Text variant="monoSmall" color="tertiary">{hostOf(serverUrl)}</Text>
            </Text>
            <View style={styles.hostingActions}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Change server. Current server: ${serverUrl}`}
                onPress={() => {
                  haptics.light();
                  setShowServer(true);
                }}
              >
                <Text variant="footnote" color="accent">Change server</Text>
              </PressableScale>
              <Text variant="footnote" color="faint"> · </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Use ordo Cloud"
                onPress={() => {
                  haptics.light();
                  setConfirmCloud(true);
                }}
              >
                <Text variant="footnote" color="accent">Use ordo Cloud</Text>
              </PressableScale>
            </View>
          </View>
        ) : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Use your own server"
            onPress={() => {
              haptics.light();
              setShowSelfHost(true);
            }}
            style={styles.hosting}
          >
            <Text variant="footnote" color="tertiary" align="center">
              Use your own server
            </Text>
          </PressableScale>
        )}
      </AuthShell>

      <SelfHostFlow visible={showSelfHost} onDismiss={() => setShowSelfHost(false)} />
      <ServerConnectSheet
        visible={showServer}
        onDismiss={() => setShowServer(false)}
        animateReadyColor
      />
      <ConfirmDialog
        visible={confirmCloud}
        onDismiss={() => {
          if (!busy) setConfirmCloud(false);
        }}
        icon="cloud-outline"
        tone="accent"
        title="Use ordo Cloud?"
        message="You'll leave this server. Your library there stays put — it isn't copied."
        confirmLabel="Use ordo Cloud"
        loading={busy}
        dismissible={!busy}
        onConfirm={() => {
          void commit(CLOUD_SERVER_URL).then((ok) => {
            if (ok) setConfirmCloud(false);
          });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  link: { textDecorationLine: "underline" },
  hosting: { marginTop: spacing[20], gap: spacing[6] },
  hostingActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
  },
  forgotRow: { marginTop: spacing[10], alignItems: "flex-end" },
});
