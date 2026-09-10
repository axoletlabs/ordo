/** Current self-hosted server, recents, and a verified switch. */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { APP_NAME, ChangeServerNameSchema } from "@ordo/shared";
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
import { FloatingPanel } from "../../../src/components/ui/FloatingPanel";
import { ThemedScrollView } from "../../../src/components/ui/ThemedScrollView";
import { PanelHeader } from "../../../src/components/ui/PanelHeader";
import { Input } from "../../../src/components/ui/Input";
import { PanelActions } from "../../../src/components/ui/SheetActionRow";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { Text } from "../../../src/components/ui/Text";
import { toast } from "../../../src/components/ui/toast-store";
import { useServerInfo } from "../../../src/hooks/queries";
import { cancelProactiveRefresh } from "../../../src/lib/api/client";
import { serverApi } from "../../../src/lib/api/server";
import { qk } from "../../../src/lib/api/query-keys";
import { queryClient } from "../../../src/lib/query-client";
import { visibleServerHistory } from "../../../src/lib/server-history";
import { hostOf } from "../../../src/lib/server-probe";
import { errorMessage } from "../../../src/lib/error-message";
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
  const [nameOpen, setNameOpen] = useState(false);

  const recents = visibleServerHistory(serverHistory, currentUrl);
  const connected = Boolean(serverInfo.data && !serverInfo.error);
  const statusLabel = serverInfo.error
    ? "Unavailable"
    : serverInfo.data
      ? "Connected"
      : "Checking…";
  const statusTone = serverInfo.error ? "danger" : serverInfo.data ? "green" : "neutral";
  const displayName = serverInfo.data?.name?.trim() || hostOf(currentUrl);
  const hostname = serverInfo.data?.hostname?.trim() || "";

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
            <View style={styles.currentMain}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Change server URL. Current server: ${currentUrl}`}
                dim
                onPress={() => openSheet(currentUrl)}
                style={[styles.iconWrap, { backgroundColor: palette.surfaceSecondary }]}
              >
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
              </PressableScale>
              <View style={styles.currentBody}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={
                    serverInfo.data
                      ? `Edit server name. Current name: ${displayName}`
                      : displayName
                  }
                  accessibilityState={{ disabled: !serverInfo.data }}
                  disabled={!serverInfo.data}
                  dim={Boolean(serverInfo.data)}
                  onPress={() => {
                    haptics.light();
                    setNameOpen(true);
                  }}
                  style={styles.nameHit}
                >
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {displayName}
                  </Text>
                </PressableScale>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Change server URL. Current server: ${currentUrl}`}
                  dim
                  onPress={() => openSheet(currentUrl)}
                  style={styles.urlHit}
                >
                  <Text variant="monoSmall" color="tertiary" numberOfLines={1}>
                    {currentUrl}
                  </Text>
                </PressableScale>
              </View>
            </View>
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
              <RefreshSpinIcon
                spinning={serverInfo.isFetching}
                color={serverInfo.isFetching ? palette.accent : palette.textTertiary}
              />
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

      <ServerNamePanel
        visible={nameOpen}
        initialName={displayName}
        hostname={hostname}
        onDismiss={() => setNameOpen(false)}
        onSaved={(info) => {
          queryClient.setQueryData(qk.serverInfo(currentUrl), info);
          setNameOpen(false);
        }}
      />

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
            {displayName}
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

function RefreshSpinIcon({ spinning, color }: { spinning: boolean; color: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (spinning) {
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, { duration: 750, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(rotation);
      rotation.value = withTiming(0, { duration: 160 });
    }
    return () => cancelAnimation(rotation);
  }, [rotation, spinning]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={spinStyle}>
      <Ionicons name="refresh" size={16} color={color} />
    </Animated.View>
  );
}

function ServerNamePanel({
  visible,
  initialName,
  hostname,
  onDismiss,
  onSaved,
}: {
  visible: boolean;
  initialName: string;
  hostname: string;
  onDismiss: () => void;
  onSaved: (info: Awaited<ReturnType<typeof serverApi.rename>>) => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const rename = useMutation({ mutationFn: serverApi.rename });

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setError("");
    }
  }, [initialName, visible]);

  const close = () => {
    if (rename.isPending) return;
    onDismiss();
  };

  const submit = async () => {
    setError("");
    const parsed = ChangeServerNameSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Please check your input.");
      return;
    }
    if (parsed.data.name === initialName.trim()) {
      onDismiss();
      return;
    }
    try {
      const info = await rename.mutateAsync(parsed.data);
      haptics.success();
      toast.success("Server name updated");
      onSaved(info);
    } catch (cause) {
      haptics.error();
      setError(errorMessage(cause));
    }
  };

  const helper = hostname
    ? hostname === name.trim()
      ? `This machine is ${hostname}. You can rename it.`
      : `This machine is ${hostname}.`
    : undefined;

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={close}
      dismissible={!rename.isPending}
      onShow={() => setTimeout(() => inputRef.current?.focus(), 100)}
    >
      <ThemedScrollView keyboardShouldPersistTaps="handled">
        <PanelHeader title="Server name" />
        <Input
          ref={inputRef}
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder={hostname || "Server name"}
          autoCapitalize="words"
          autoComplete="off"
          error={error || undefined}
          helper={error ? undefined : helper}
          onSubmitEditing={() => void submit()}
        />
        <PanelActions
          confirmLabel="Save"
          onConfirm={() => void submit()}
          onCancel={close}
          loading={rename.isPending}
          confirmDisabled={!name.trim()}
        />
      </ThemedScrollView>
    </FloatingPanel>
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
    paddingVertical: spacing[8],
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  currentBody: { flex: 1, minWidth: 0 },
  nameHit: {
    alignSelf: "stretch",
    borderRadius: radius.sm,
    paddingVertical: spacing[2],
  },
  urlHit: {
    alignSelf: "stretch",
    borderRadius: radius.sm,
    paddingVertical: spacing[2],
    marginTop: spacing[2],
  },
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
