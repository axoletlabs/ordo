/** Verify and switch the self-hosted ordo server. */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { APP_NAME } from "@ordo/shared";
import {
  SettingsForm,
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { ServerHistoryPanel } from "../../../src/components/settings/ServerHistoryPanel";
import { Input } from "../../../src/components/ui/Input";
import { Button } from "../../../src/components/ui/Button";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { ServerProbeLog } from "../../../src/components/ui/ServerProbeLog";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { Text } from "../../../src/components/ui/Text";
import { toast } from "../../../src/components/ui/toast-store";
import { useServerInfo } from "../../../src/hooks/queries";
import { cancelProactiveRefresh } from "../../../src/lib/api/client";
import { queryClient } from "../../../src/lib/query-client";
import { visibleServerHistory } from "../../../src/lib/server-history";
import {
  hostOf,
  normalizeServerUrl,
  probeServer,
  type ProbeStep,
} from "../../../src/lib/server-probe";
import { useAuthStore } from "../../../src/store/auth";
import { useFolderTokenStore } from "../../../src/store/folder-tokens";
import { useSettingsStore } from "../../../src/store/settings";
import { restartRuntime } from "../../../src/store/update-restart";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { haptics } from "../../../src/lib/haptics";
import { radius, spacing } from "../../../src/theme/tokens";

function RefreshConnectionButton({
  refreshing,
  onPress,
}: {
  refreshing: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const rotation = useSharedValue(0);
  const wasRefreshing = useRef(false);

  useEffect(() => {
    cancelAnimation(rotation);
    if (refreshing) {
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, { duration: 850, easing: Easing.linear }),
        -1,
        false,
      );
    } else if (wasRefreshing.current) {
      const nextTurn = Math.ceil(rotation.value / 360) * 360;
      rotation.value = withTiming(nextTurn, { duration: 180, easing: Easing.out(Easing.quad) });
    } else {
      rotation.value = 0;
    }
    wasRefreshing.current = refreshing;
    return () => cancelAnimation(rotation);
  }, [refreshing, rotation]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Refresh current server connection"
      accessibilityState={{ disabled: refreshing }}
      style={[styles.refreshAction, { backgroundColor: palette.accentSoft }]}
      scaleTo={0.88}
      hitSlop={8}
      disabled={refreshing}
      onPress={onPress}
    >
      <Animated.View style={iconStyle}>
        <Ionicons name="refresh" size={19} color={palette.accent} />
      </Animated.View>
    </PressableScale>
  );
}

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
  const [url, setUrl] = useState(currentUrl);
  const [steps, setSteps] = useState<ProbeStep[]>([]);
  const [probing, setProbing] = useState(false);
  const [reachable, setReachable] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalized = normalizeServerUrl(url);
  const unchanged = !normalized || normalized === normalizeServerUrl(currentUrl);
  const canChange =
    !!normalized && !unchanged && reachable && !probing && !rechecking && !switching && !confirmedUrl;
  const recents = visibleServerHistory(serverHistory, currentUrl);

  useEffect(() => {
    let cancelled = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (unchanged) {
      setSteps([]);
      setReachable(false);
      setProbing(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setProbing(true);
      setReachable(false);
      void probeServer(url, (nextSteps) => {
        if (!cancelled) setSteps(nextSteps);
      }).then((result) => {
        if (cancelled) return;
        setProbing(false);
        setReachable(result.status === "up");
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
    const result = await probeServer(normalized, setSteps);
    setRechecking(false);
    if (result.status === "up" && result.url) {
      setConfirmedUrl(result.url);
    } else {
      setReachable(false);
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

  const connectionValue = serverInfo.error
    ? "Unavailable"
    : serverInfo.data
      ? "Connected"
      : "Checking…";
  const refreshConnection = () => {
    if (serverInfo.isFetching) return;
    haptics.light();
    void serverInfo.refetch();
  };

  return (
    <SettingsPage title="Server">
      <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <SettingsGroup label="Current server" compact>
          <SettingRow
            icon={
              serverInfo.isLoading
                ? "sync-outline"
                : serverInfo.data && !serverInfo.error
                  ? "checkmark-circle-outline"
                  : "cloud-offline-outline"
            }
            label={hostOf(currentUrl)}
            description={currentUrl}
            value={connectionValue}
            rightFit="content"
            right={
              <RefreshConnectionButton
                refreshing={serverInfo.isFetching}
                onPress={refreshConnection}
              />
            }
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

        <SettingsGroup label="Change server">
          <SettingsForm style={styles.editor}>
            <Input
              label="Server URL"
              value={url}
              onChangeText={setUrl}
              placeholder="https://ordo.example.com"
              mono
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              icon={<Ionicons name="link" size={15} color={palette.textTertiary} />}
            />
            {!unchanged ? <ServerProbeLog steps={steps} probing={probing} /> : null}
            <Button
              label="Change server"
              block
              size="lg"
              disabled={!canChange}
              loading={rechecking}
              onPress={() => void requestSwitch()}
              style={styles.changeButton}
            />
          </SettingsForm>
        </SettingsGroup>
      </SettingsScrollView>

      <ConfirmDialog
        visible={!!confirmedUrl}
        onDismiss={() => setConfirmedUrl(null)}
        icon="log-out-outline"
        title="Switch server?"
        message={`You'll be signed out, and ${APP_NAME} will restart.`}
        confirmLabel="Switch"
        loading={switching}
        dismissible={!switching}
        onConfirm={() => void confirmSwitch()}
      >
        <View style={[styles.hostChange, { borderColor: palette.border }]}>
          <Text variant="monoSmall" color="tertiary" numberOfLines={1}>
            {hostOf(currentUrl)}
          </Text>
          <Ionicons name="arrow-down" size={14} color={palette.textTertiary} />
          <Text variant="monoSmall" numberOfLines={1}>
            {confirmedUrl ? hostOf(confirmedUrl) : ""}
          </Text>
        </View>
      </ConfirmDialog>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  editor: { padding: spacing[16] },
  changeButton: { marginTop: spacing[16] },
  refreshAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  hostChange: {
    padding: spacing[14],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    gap: spacing[8],
  },
});
