/** Current self-hosted server, recents, and a verified switch. */
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { APP_NAME } from "@ordo/shared";
import {
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { ServerHistoryPanel } from "../../../src/components/settings/ServerHistoryPanel";
import { ServerConnectSheet } from "../../../src/components/auth/ServerConnectSheet";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Badge } from "../../../src/components/ui/Badge";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { Text } from "../../../src/components/ui/Text";
import { toast } from "../../../src/components/ui/toast-store";
import { useServerInfo } from "../../../src/hooks/queries";
import { cancelProactiveRefresh } from "../../../src/lib/api/client";
import { queryClient } from "../../../src/lib/query-client";
import { visibleServerHistory } from "../../../src/lib/server-history";
import { hostOf } from "../../../src/lib/server-probe";
import { useAuthStore } from "../../../src/store/auth";
import { useFolderTokenStore } from "../../../src/store/folder-tokens";
import { useSettingsStore } from "../../../src/store/settings";
import { restartRuntime } from "../../../src/store/update-restart";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { haptics } from "../../../src/lib/haptics";
import { radius, spacing } from "../../../src/theme/tokens";

export default function ServerScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const serverHistory = useSettingsStore((s) => s.serverHistory);
  const removeServerHistory = useSettingsStore((s) => s.removeServerHistory);
  const clearAuth = useAuthStore((s) => s.clear);
  const clearFolderTokens = useFolderTokenStore((s) => s.clearAll);
  const serverInfo = useServerInfo();
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const recents = visibleServerHistory(serverHistory, currentUrl);
  const connected = Boolean(serverInfo.data && !serverInfo.error);
  const statusLabel = serverInfo.error
    ? "Unavailable"
    : serverInfo.data
      ? "Connected"
      : "Checking…";
  const statusTone = serverInfo.error ? "danger" : serverInfo.data ? "green" : "neutral";

  const openSheet = (url: string) => {
    haptics.light();
    setSheetUrl(url);
  };

  const refreshConnection = () => {
    if (serverInfo.isFetching) return;
    haptics.light();
    void serverInfo.refetch();
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

  return (
    <SettingsPage title="Server">
      <SettingsScrollView>
        <SettingsGroup label="This server" compact>
          <View
            style={[
              styles.current,
              { borderBottomColor: palette.border },
              !serverInfo.data && styles.noDivider,
            ]}
          >
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Change server URL. Current server: ${currentUrl}`}
              dim
              onPress={() => openSheet(currentUrl)}
              style={styles.currentMain}
            >
              <View style={[styles.iconWrap, { backgroundColor: palette.surfaceSecondary }]}>
                <Ionicons
                  name={
                    serverInfo.isLoading
                      ? "cloud-outline"
                      : connected
                        ? "checkmark-circle-outline"
                        : "cloud-offline-outline"
                  }
                  size={16}
                  color={palette.accent}
                />
              </View>
              <View style={styles.currentBody}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {hostOf(currentUrl)}
                </Text>
                <Text variant="footnote" color="tertiary" numberOfLines={1} style={styles.currentUrl}>
                  {currentUrl}
                </Text>
              </View>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Recheck connection"
              accessibilityState={{ busy: serverInfo.isFetching }}
              hitSlop={8}
              disabled={serverInfo.isFetching}
              onPress={refreshConnection}
              style={styles.status}
            >
              <Badge tone={statusTone}>{statusLabel}</Badge>
              {serverInfo.isFetching ? (
                <ActivityIndicator size="small" color={palette.accent} />
              ) : (
                <Ionicons name="refresh" size={16} color={palette.textTertiary} />
              )}
            </PressableScale>
          </View>
          {serverInfo.data ? (
            <SettingRow
              icon="pricetag-outline"
              label="Version"
              value={`v${serverInfo.data.version}`}
              divider={false}
            />
          ) : null}
        </SettingsGroup>

        <ServerHistoryPanel
          entries={recents}
          busy={switching}
          onSelect={openSheet}
          onRemove={(target) => {
            haptics.light();
            removeServerHistory(target);
          }}
        />
      </SettingsScrollView>

      <ServerConnectSheet
        visible={sheetUrl != null}
        initialUrl={sheetUrl ?? currentUrl}
        onDismiss={() => setSheetUrl(null)}
        onCommit={(url) => {
          setSheetUrl(null);
          setConfirmedUrl(url);
        }}
      />

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
  current: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noDivider: { borderBottomWidth: 0 },
  currentMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 52,
    paddingLeft: spacing[16],
    paddingVertical: spacing[10],
    borderRadius: radius.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  currentBody: { flex: 1, minWidth: 0 },
  currentUrl: { marginTop: spacing[2] },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    paddingRight: spacing[12],
    paddingLeft: spacing[4],
    minHeight: 44,
  },
  hostChange: { gap: spacing[6], paddingHorizontal: spacing[8] },
});
