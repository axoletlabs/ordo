/**
 * Opt-in flow to leave ordo Cloud for a server the user runs.
 *
 * Intentionally several steps: what self-hosting means, a typed disclaimer,
 * then a verified address. The URL store is only written after the last step.
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
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
import {
  CLOUD_SERVER_URL,
  SELF_HOST_CONFIRMATION,
  canAcknowledgeSelfHost,
  isCloudServerUrl,
} from "../../lib/hosting";
import { probeServer, hostOf, normalizeServerUrl } from "../../lib/server-probe";
import { visibleServerHistory } from "../../lib/server-history";
import { timeAgo } from "../../lib/format";

type Step = "intro" | "acknowledge" | "address";

const STEPS: Step[] = ["intro", "acknowledge", "address"];

const SETUP_ITEMS = [
  "Keep the server online, updated, and backed up.",
  "TLS and who can reach it.",
  "SMTP if you want verification and password-reset email.",
] as const;

const LIMITATION_ITEMS = [
  "Email codes print in the server console until SMTP is set.",
  "Registration, required MFA, and other flags follow your config.",
  "Features we add for ordo Cloud may not exist on your server.",
] as const;

export function SelfHostFlow({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const { palette } = useTheme();
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const serverHistory = useSettingsStore((s) => s.serverHistory);
  const signedIn = useAuthStore((s) => s.status === "authenticated");
  const { commit, busy } = useCommitServerSwitch();
  const inputRef = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>("intro");
  const [acceptedResponsibility, setAcceptedResponsibility] = useState(false);
  const [acceptedLimitations, setAcceptedLimitations] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const recents = visibleServerHistory(serverHistory, currentUrl, [CLOUD_SERVER_URL]);
  const probe = useServerProbe(url, currentUrl, visible && step === "address");
  const cloudTyped = Boolean(probe.normalized && isCloudServerUrl(probe.normalized));
  const probeCopy = cloudTyped
    ? { error: "That's ordo Cloud. Cancel if you want the hosted service.", helper: undefined }
    : probe.probeCopy;
  const canConnect =
    probe.canChange && !cloudTyped && !confirming && !busy && !pendingUrl;
  const acknowledged = canAcknowledgeSelfHost({
    acceptedResponsibility,
    acceptedLimitations,
    confirmation,
  });
  const stepIndex = STEPS.indexOf(step) + 1;
  const switching = confirming || busy || Boolean(pendingUrl);

  useEffect(() => {
    if (!visible) {
      setStep("intro");
      setAcceptedResponsibility(false);
      setAcceptedLimitations(false);
      setConfirmation("");
      setUrl("");
      setConfirming(false);
      setPendingUrl(null);
    }
  }, [visible]);

  useEffect(() => {
    if (visible && step === "address") {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [step, visible]);

  const close = () => {
    if (switching) return;
    onDismiss();
  };

  const goBack = () => {
    if (switching) return;
    if (step === "acknowledge") setStep("intro");
    else if (step === "address") setStep("acknowledge");
    else close();
  };

  const goNext = () => {
    haptics.light();
    if (step === "intro") setStep("acknowledge");
    else if (step === "acknowledge" && acknowledged) setStep("address");
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
      setPendingUrl(null);
      onDismiss();
    }
  };

  return (
    <>
      <FloatingPanel visible={visible} onDismiss={close} dismissible={!switching}>
        <ThemedScrollView keyboardShouldPersistTaps="handled">
          <PanelHeader
            icon={step === "address" ? "link-outline" : "server-outline"}
            iconColor={palette.accent}
            iconBackground={palette.accentSoft}
            title={
              step === "intro"
                ? "Use your own server"
                : step === "acknowledge"
                  ? "Before you continue"
                  : "Server address"
            }
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
                Axolet Labs does not operate, monitor, or back up a server you host, and is
                not responsible for downtime, data loss, or anything that happens on it.
              </Text>
              <Text variant="label" color="tertiary">
                You look after
              </Text>
              <CopyList items={SETUP_ITEMS} />
              <Text variant="label" color="tertiary">
                Until you configure it
              </Text>
              <CopyList items={LIMITATION_ITEMS} />
            </View>
          ) : null}

          {step === "acknowledge" ? (
            <View style={styles.stack}>
              <Text variant="footnote" color="secondary">
                This is unsupported. If the server goes down, loses data, or is
                misconfigured, that is on you.
              </Text>
              <CheckRow
                label="I understand Axolet Labs is not responsible for my server or my data."
                checked={acceptedResponsibility}
                onToggle={() => {
                  haptics.selection();
                  setAcceptedResponsibility((value) => !value);
                }}
              />
              <CheckRow
                label="I understand some features need extra setup or may be unavailable."
                checked={acceptedLimitations}
                onToggle={() => {
                  haptics.selection();
                  setAcceptedLimitations((value) => !value);
                }}
              />
              <Input
                label="Type to confirm"
                value={confirmation}
                onChangeText={setConfirmation}
                placeholder={SELF_HOST_CONFIRMATION}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                helper={`Type ${SELF_HOST_CONFIRMATION} exactly.`}
              />
            </View>
          ) : null}

          {step === "address" ? (
            <View style={styles.stack}>
              <Text variant="footnote" color="secondary">
                We'll check that this is an ordo server before connecting.
              </Text>
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
              {recents.length > 0 ? (
                <View style={styles.recents}>
                  <Text variant="label" color="tertiary">Recent</Text>
                  {recents.map((entry) => {
                    const selected = normalizeServerUrl(url) === entry.url;
                    return (
                      <PressableScale
                        key={entry.url}
                        accessibilityRole="button"
                        accessibilityLabel={`Use recent server ${hostOf(entry.url)}`}
                        disabled={switching}
                        onPress={() => {
                          haptics.selection();
                          setUrl(entry.url);
                        }}
                        style={[
                          styles.recentRow,
                          {
                            backgroundColor: palette.surfaceSecondary,
                            borderColor: selected ? palette.accent : "transparent",
                          },
                        ]}
                      >
                        <Ionicons
                          name={selected ? "checkmark" : "time-outline"}
                          size={14}
                          color={selected ? palette.accent : palette.textTertiary}
                        />
                        <View style={styles.recentCopy}>
                          <Text
                            variant="subhead"
                            numberOfLines={1}
                            color={selected ? "accent" : "primary"}
                          >
                            {hostOf(entry.url)}
                          </Text>
                          <Text variant="footnote" color="tertiary" numberOfLines={1}>
                            {timeAgo(new Date(entry.lastConnectedAt).toISOString())}
                          </Text>
                        </View>
                      </PressableScale>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

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
              <Button
                label="Continue"
                variant="primary"
                onPress={goNext}
                disabled={step === "acknowledge" && !acknowledged}
                style={styles.action}
              />
            )}
          </View>
        </ThemedScrollView>
      </FloatingPanel>

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
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={[
        styles.check,
        {
          backgroundColor: palette.surfaceSecondary,
          borderColor: checked ? palette.accent : "transparent",
        },
      ]}
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={20}
        color={checked ? palette.accent : palette.textTertiary}
      />
      <Text variant="footnote" style={styles.checkLabel}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing[12] },
  list: { gap: spacing[6] },
  listRow: { flexDirection: "row", gap: spacing[8], alignItems: "flex-start" },
  listCopy: { flex: 1 },
  check: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[10],
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[10],
  },
  checkLabel: { flex: 1 },
  recents: { gap: spacing[6] },
  recentRow: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[10],
  },
  recentCopy: { flex: 1, minWidth: 0 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    marginTop: spacing[16],
  },
  action: { flex: 1 },
});
