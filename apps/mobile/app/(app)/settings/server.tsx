/** Current self-hosted server, recents, and a verified switch. */
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { APP_NAME, type ServerInfoDto } from "@ordo/shared";
import {
  SettingsForm,
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { ServerHistoryPanel } from "../../../src/components/settings/ServerHistoryPanel";
import { Input } from "../../../src/components/ui/Input";
import { Button } from "../../../src/components/ui/Button";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Badge } from "../../../src/components/ui/Badge";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { Text } from "../../../src/components/ui/Text";
import { toast } from "../../../src/components/ui/toast-store";
import { useServerInfo } from "../../../src/hooks/queries";
import { cancelProactiveRefresh } from "../../../src/lib/api/client";
import { queryClient } from "../../../src/lib/query-client";
import { visibleServerHistory } from "../../../src/lib/server-history";
import {
  describeProbeField,
  hostOf,
  normalizeServerUrl,
  probeServer,
} from "../../../src/lib/server-probe";
import { useAuthStore } from "../../../src/store/auth";
import { useFolderTokenStore } from "../../../src/store/folder-tokens";
import { useSettingsStore } from "../../../src/store/settings";
import { restartRuntime } from "../../../src/store/update-restart";
import { haptics } from "../../../src/lib/haptics";
import { spacing } from "../../../src/theme/tokens";

export default function ServerScreen() {
  const router = useRouter();
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const serverHistory = useSettingsStore((s) => s.serverHistory);
  const removeServerHistory = useSettingsStore((s) => s.removeServerHistory);
  const clearAuth = useAuthStore((s) => s.clear);
  const clearFolderTokens = useFolderTokenStore((s) => s.clearAll);
  const serverInfo = useServerInfo();
  const [url, setUrl] = useState(currentUrl);
  const [probing, setProbing] = useState(false);
  const [reachable, setReachable] = useState(false);
  const [probeDetail, setProbeDetail] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<Pick<ServerInfoDto, "name" | "version"> | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalized = normalizeServerUrl(url);
  const unchanged = !normalized || normalized === normalizeServerUrl(currentUrl);
  const canChange =
    !!normalized && !unchanged && reachable && !probing && !rechecking && !switching && !confirmedUrl;
  const recents = visibleServerHistory(serverHistory, currentUrl);
  const probeCopy = describeProbeField({
    idle: unchanged,
    probing,
    reachable,
    detail: probeDetail,
    info: probeInfo,
  });

  useEffect(() => {
    let cancelled = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (unchanged) {
      setReachable(false);
      setProbing(false);
      setProbeDetail(null);
      setProbeInfo(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setProbing(true);
      setReachable(false);
      setProbeDetail(null);
      setProbeInfo(null);
      void probeServer(url).then((result) => {
        if (cancelled) return;
        setProbing(false);
        setReachable(result.status === "up");
        setProbeDetail(result.detail ?? null);
        setProbeInfo(result.info ?? null);
      });
    }, 900);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [unchanged, url]);

  const requestSwitch = async () => {
    if (!normalized || !canChange) return;
    setRechecking(true);
    const result = await probeServer(normalized);
    setRechecking(false);
    if (result.status === "up" && result.url) {
      setConfirmedUrl(result.url);
    } else {
      setReachable(false);
      setProbeDetail(result.detail ?? null);
      setProbeInfo(null);
    }
  };

  const confirmSwitch = async () => {
    if (!confirmedUrl || switching) return;
    setSwitching(true);
    let switchCommitted = false;

    try {
      await restartRuntime(async () => {
        cancelProactiveRefresh();
        queryClient.clear();
        await Promise.all([
          clearAuth(),
          clearFolderTokens(),
          setServerUrl(confirmedUrl),
        ]);
        switchCommitted = true;
      });
    } catch {
      if (!switchCommitted) {
        setSwitching(false);
        toast.error("Couldn't change server.");
        return;
      }
    }

    if (switchCommitted) {
      setSwitching(false);
      setConfirmedUrl(null);
      toast.success("Server changed");
      router.replace("/(auth)/login");
    }
  };

  const connected = Boolean(serverInfo.data && !serverInfo.error);
  const statusLabel = serverInfo.error
    ? "Unavailable"
    : serverInfo.data
      ? "Connected"
      : "Checking…";
  const statusTone = serverInfo.error ? "danger" : serverInfo.data ? "green" : "neutral";
  const refreshConnection = () => {
    if (serverInfo.isFetching) return;
    haptics.light();
    void serverInfo.refetch();
  };

  return (
    <SettingsPage title="Server">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <SettingsGroup label="This server" compact>
            <SettingRow
              icon={
                serverInfo.isLoading
                  ? "cloud-outline"
                  : connected
                    ? "checkmark-circle-outline"
                    : "cloud-offline-outline"
              }
              label={hostOf(currentUrl)}
              description={currentUrl}
              right={<Badge tone={statusTone}>{statusLabel}</Badge>}
              rightFit="content"
            />
            {serverInfo.data ? (
              <SettingRow
                icon="pricetag-outline"
                label="Version"
                value={`v${serverInfo.data.version}`}
              />
            ) : null}
            <SettingRow
              icon="refresh-outline"
              label="Recheck connection"
              value={serverInfo.isFetching ? "Checking…" : undefined}
              onPress={refreshConnection}
              divider={false}
            />
          </SettingsGroup>

          <ServerHistoryPanel
            entries={recents}
            selectedUrl={url}
            busy={rechecking || switching}
            onSelect={(target) => {
              haptics.selection();
              setUrl(target);
            }}
            onRemove={(target) => {
              haptics.light();
              removeServerHistory(target);
            }}
          />

          <SettingsGroup
            label="Change server"
            footer={`You'll be signed out, and ${APP_NAME} will restart.`}
          >
            <SettingsForm style={styles.editor}>
              <Input
                label="Server URL"
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
                error={probeCopy.error}
                helper={probeCopy.helper}
              />
              <Button
                label="Change server"
                block
                size="lg"
                disabled={!canChange}
                loading={rechecking}
                onPress={() => void requestSwitch()}
              />
            </SettingsForm>
          </SettingsGroup>
        </SettingsScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={!!confirmedUrl}
        onDismiss={() => setConfirmedUrl(null)}
        icon="swap-horizontal-outline"
        title="Switch server?"
        message={`You'll be signed out, and ${APP_NAME} will restart.`}
        confirmLabel="Switch"
        loading={switching}
        dismissible={!switching}
        onConfirm={() => void confirmSwitch()}
      >
        <View style={styles.hostChange}>
          <Text variant="footnote" color="tertiary" numberOfLines={1} align="center">
            {hostOf(currentUrl)}
          </Text>
          <Text variant="caption" color="faint" align="center">
            to
          </Text>
          <Text variant="bodyStrong" numberOfLines={1} align="center">
            {confirmedUrl ? hostOf(confirmedUrl) : ""}
          </Text>
        </View>
      </ConfirmDialog>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  editor: { padding: spacing[16], gap: spacing[12] },
  hostChange: { gap: spacing[6], paddingHorizontal: spacing[8] },
});
