/**
 * Opt-in flow to leave ordo Cloud for a server the user runs.
 *
 * Two steps: what self-hosting means with one responsibility checkbox, then a
 * verified address. The URL store is only written after the last step.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, View, type TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { APP_NAME } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { useSettingsStore } from "../../store/settings";
import { useAuthStore } from "../../store/auth";
import { useServerProbe } from "../../hooks/use-server-probe";
import { useCommitServerSwitch } from "../../hooks/use-commit-server-switch";
import { isCloudServerUrl } from "../../lib/hosting";
import { probeServer } from "../../lib/server-probe";

type Step = "intro" | "address";

const STEPS: Step[] = ["intro", "address"];

export function SelfHostFlow({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const signedIn = useAuthStore((s) => s.status === "authenticated");
  const { commit, busy } = useCommitServerSwitch();
  const inputRef = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>("intro");
  const [acceptedResponsibility, setAcceptedResponsibility] = useState(false);
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const probe = useServerProbe(url, currentUrl, visible && step === "address");
  const cloudTyped = Boolean(probe.normalized && isCloudServerUrl(probe.normalized));
  const probeCopy = cloudTyped
    ? { error: "That's ordo Cloud. Cancel if you want the hosted service.", helper: undefined }
    : probe.probeCopy;
  const canConnect =
    probe.canChange && !cloudTyped && !confirming && !busy && !pendingUrl;
  const stepIndex = STEPS.indexOf(step) + 1;
  const switching = confirming || busy || Boolean(pendingUrl);

  useLayoutEffect(() => {
    if (!visible) return;
    setStep("intro");
    setAcceptedResponsibility(false);
    setUrl("");
    setConfirming(false);
    setPendingUrl(null);
  }, [visible]);

  useEffect(() => {
    if (visible && !pendingUrl && step === "address") {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [pendingUrl, step, visible]);

  useEffect(() => {
    if (step !== "address") Keyboard.dismiss();
  }, [step]);

  const close = () => {
    if (switching) return;
    onDismiss();
  };

  const goBack = () => {
    if (switching) return;
    if (step === "address") {
      Keyboard.dismiss();
      inputRef.current?.blur();
      setStep("intro");
      return;
    }
    close();
  };

  const goNext = () => {
    if (!acceptedResponsibility) return;
    setStep("address");
  };

  const connect = async () => {
    if (!probe.normalized || !canConnect) return;
    setConfirming(true);
    const recheck = await probeServer(probe.normalized);
    setConfirming(false);
    if (recheck.status !== "up" || !recheck.url || isCloudServerUrl(recheck.url)) {
      probe.setUp(false);
      probe.setProbeDetail(recheck.detail ?? null);
      probe.setProbeInfo(null);
      return;
    }
    if (signedIn) {
      setPendingUrl(recheck.url);
      return;
    }
    const ok = await commit(recheck.url);
    if (ok) onDismiss();
  };

  const confirmSignedInSwitch = async () => {
    if (!pendingUrl) return;
    const ok = await commit(pendingUrl);
    if (ok) {
      onDismiss();
      setPendingUrl(null);
    }
  };

  return (
    <>
      {!pendingUrl ? (
      <FloatingPanel visible={visible} onDismiss={close} dismissible={!switching}>
        <ThemedScrollView keyboardShouldPersistTaps="handled">
          <PanelHeader
            title={step === "intro" ? "Use your own server" : "Server address"}
            accessory={
              <Text variant="caption" color="tertiary">
                {stepIndex} / {STEPS.length}
              </Text>
            }
          />

          {step === "intro" ? (
            <View style={styles.stack}>
              <Text variant="footnote" color="secondary">
                ordo Cloud is the default. Your own server is optional, and you run it.
              </Text>
              <Text variant="footnote" color="secondary">
                Axolet does not operate, monitor, or back up a server you host, and is
                not responsible for downtime, data loss, or anything that happens on it.
              </Text>
              <Text variant="label" color="tertiary">
                You look after
              </Text>
              <CopyList
                items={[
                  "Keep the server online, updated, and backed up.",
                  "TLS and who can reach it.",
                  "SMTP if you want verification and password-reset email.",
                ]}
              />
              <CheckRow
                label="I understand Axolet is not responsible for my server or my data."
                checked={acceptedResponsibility}
                onToggle={() => {
                  haptics.selection();
                  setAcceptedResponsibility((value) => !value);
                }}
              />
            </View>
          ) : (
            <View style={styles.stack}>
              <Input
                ref={inputRef}
                value={url}
                onChangeText={setUrl}
                placeholder="https://ordo.example.com"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="URL"
                importantForAutofill="no"
                spellCheck={false}
                mono
                editable={!switching}
                error={probeCopy.error}
                helper={probeCopy.helper}
                onSubmitEditing={() => void connect()}
              />
            </View>
          )}

          <View style={styles.actions}>
            <Button
              label={step === "intro" ? "Cancel" : "Back"}
              variant="secondary"
              onPress={goBack}
              disabled={switching}
              style={styles.action}
            />
            {step === "address" ? (
              <Button
                label="Connect"
                variant="primary"
                onPress={() => void connect()}
                disabled={!canConnect}
                loading={confirming || busy}
                style={styles.action}
              />
            ) : (
              <ContinueButton ready={acceptedResponsibility} onPress={goNext} />
            )}
          </View>
        </ThemedScrollView>
      </FloatingPanel>
      ) : null}

      <ConfirmDialog
        visible={Boolean(pendingUrl)}
        onDismiss={() => {
          if (!busy) setPendingUrl(null);
        }}
        icon="swap-horizontal-outline"
        title="Switch server?"
        message={`You'll be signed out, and ${APP_NAME} will restart. This server's library isn't copied.`}
        confirmLabel="Switch"
        loading={busy}
        dismissible={!busy}
        onConfirm={() => void confirmSignedInSwitch()}
      />
    </>
  );
}

function CopyList({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} style={styles.listRow}>
          <Text variant="footnote" color="secondary">
            ·
          </Text>
          <Text variant="footnote" color="secondary" style={styles.listCopy}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ContinueButton({
  ready,
  onPress,
}: {
  ready: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Continue"
      accessibilityState={{ disabled: !ready }}
      disabled={!ready}
      onPress={() => {
        haptics.light();
        onPress();
      }}
      style={[
        styles.action,
        styles.continue,
        {
          backgroundColor: ready ? palette.accent : palette.surfaceSecondary,
          borderColor: ready ? palette.accent : palette.surfaceSecondary,
        },
      ]}
    >
      <Text
        variant="header"
        numberOfLines={1}
        style={{ color: ready ? palette.onAccent : palette.textTertiary }}
      >
        Continue
      </Text>
    </PressableScale>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      hitSlop={8}
      style={styles.check}
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={20}
        color={checked ? palette.accent : palette.textTertiary}
      />
      <Text variant="footnote" style={styles.checkLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing[12], paddingHorizontal: spacing[4] },
  list: { gap: spacing[6] },
  listRow: { flexDirection: "row", gap: spacing[8], alignItems: "flex-start" },
  listCopy: { flex: 1 },
  check: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[8],
    alignSelf: "stretch",
  },
  checkLabel: { flex: 1 },
  actions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing[8],
    marginTop: spacing[16],
    paddingHorizontal: spacing[4],
  },
  action: { flex: 1, minWidth: 0 },
  continue: {
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing[16],
  },
});
