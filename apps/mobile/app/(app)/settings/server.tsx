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
import { APP_NAME, ChangeServerNameSchema, type ServerInfoDto } from "@ordo/shared";
import {
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { ServerHistoryPanel } from "../../../src/components/settings/ServerHistoryPanel";
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
import { hostOf, instanceNameOf } from "../../../src/lib/instance-name";
import {
  describeProbeField,
  normalizeServerUrl,
  probeServer,
} from "../../../src/lib/server-probe";
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
  const [editorUrl, setEditorUrl] = useState<string | null>(null);
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
  const displayName = instanceNameOf(serverInfo.data, currentUrl);
  const hostname = serverInfo.data?.hostname?.trim() || "";

  const openEditor = (url: string) => {
    haptics.light();
    setEditorUrl(url);
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
              accessibilityLabel={`Edit server ${displayName}, ${currentUrl}. ${statusLabel}`}
              dim
              onPress={() => openEditor(currentUrl)}
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
                  {displayName}
                </Text>
                <Text variant="monoSmall" color="tertiary" numberOfLines={1} style={styles.currentUrl}>
                  {currentUrl}
                </Text>
              </View>
              <View style={styles.status}>
                <Badge tone={statusTone}>{statusLabel}</Badge>
                {serverInfo.isFetching ? (
                  <RefreshSpinIcon spinning color={palette.accent} />
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.textFaint} />
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
          onSelect={openEditor}
          onRemove={(target) => {
            haptics.light();
            removeServerHistory(target);
          }}
        />
      </SettingsScrollView>

      {editorUrl != null ? (
        <ServerEditPanel
          key={editorUrl}
          visible
          initialName={displayName}
          initialUrl={editorUrl}
          hostname={hostname}
          canRename={Boolean(serverInfo.data)}
          onDismiss={() => setEditorUrl(null)}
          onRenamed={(info) => {
            queryClient.setQueryData(qk.serverInfo(currentUrl), info);
          }}
          onChangeUrl={(url) => {
            setEditorUrl(null);
            setConfirmedUrl(url);
          }}
        />
      ) : null}

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

function ServerEditPanel({
  visible,
  initialName,
  initialUrl,
  hostname,
  canRename,
  onDismiss,
  onRenamed,
  onChangeUrl,
}: {
  visible: boolean;
  initialName: string;
  initialUrl: string;
  hostname: string;
  canRename: boolean;
  onDismiss: () => void;
  onRenamed: (info: Awaited<ReturnType<typeof serverApi.rename>>) => void;
  onChangeUrl: (url: string) => void;
}) {
  const nameRef = useRef<TextInput>(null);
  const urlRef = useRef<TextInput>(null);
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [nameError, setNameError] = useState("");
  const [probing, setProbing] = useState(false);
  const [up, setUp] = useState(false);
  const [probeDetail, setProbeDetail] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<Pick<ServerInfoDto, "name" | "version"> | null>(null);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rename = useMutation({ mutationFn: serverApi.rename });

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const normalized = normalizeServerUrl(url);
    if (!normalized || normalized === normalizeServerUrl(currentUrl)) {
      setUp(false);
      setProbeDetail(null);
      setProbeInfo(null);
      setProbing(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (cancelled) return;
      setProbing(true);
      setUp(false);
      setProbeDetail(null);
      setProbeInfo(null);
      void probeServer(url).then((result) => {
        if (cancelled) return;
        setProbing(false);
        setUp(result.status === "up");
        setProbeDetail(result.detail ?? null);
        setProbeInfo(result.info ?? null);
      });
    }, 900);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentUrl, url, visible]);

  const normalized = normalizeServerUrl(url);
  const urlDirty = Boolean(normalized && normalized !== normalizeServerUrl(currentUrl));
  const nameDirty = canRename && name.trim() !== initialName.trim();
  const probeCopy = describeProbeField({
    idle: !urlDirty,
    probing,
    reachable: up,
    detail: probeDetail,
    info: probeInfo,
  });
  const canChangeUrl = urlDirty && up && !probing;
  const confirmDisabled =
    busy ||
    rename.isPending ||
    (canRename && !name.trim()) ||
    (urlDirty ? !canChangeUrl : !nameDirty);
  const confirmLabel = urlDirty ? "Change" : "Save";

  const close = () => {
    if (busy || rename.isPending) return;
    onDismiss();
  };

  const saveNameIfNeeded = async () => {
    if (!canRename || !nameDirty) return;
    const parsed = ChangeServerNameSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message || "Please check your input.");
      throw new Error("invalid_name");
    }
    const info = await rename.mutateAsync(parsed.data);
    onRenamed(info);
  };

  const submit = async () => {
    setNameError("");
    try {
      if (urlDirty) {
        if (!normalized || !canChangeUrl) return;
        setBusy(true);
        const recheck = await probeServer(normalized);
        if (recheck.status !== "up" || !recheck.url) {
          setUp(false);
          setProbeDetail(recheck.detail ?? null);
          setProbeInfo(null);
          return;
        }
        await saveNameIfNeeded();
        haptics.light();
        onChangeUrl(recheck.url);
        return;
      }
      await saveNameIfNeeded();
      haptics.success();
      toast.success("Server name updated");
      onDismiss();
    } catch (cause) {
      if ((cause as Error).message === "invalid_name") return;
      haptics.error();
      setNameError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={close}
      dismissible={!busy && !rename.isPending}
      onShow={() =>
        setTimeout(() => {
          if (normalizeServerUrl(initialUrl) !== normalizeServerUrl(currentUrl)) {
            urlRef.current?.focus();
          } else {
            (canRename ? nameRef : urlRef).current?.focus();
          }
        }, 100)
      }
    >
      <ThemedScrollView keyboardShouldPersistTaps="handled">
        <PanelHeader title="Server" />
        <View style={styles.fields}>
          <Input
            ref={nameRef}
            label="Name"
            value={name}
            onChangeText={(next) => {
              setNameError("");
              setName(next);
            }}
            placeholder={hostname || "Server name"}
            autoCapitalize="words"
            autoComplete="off"
            editable={canRename && !busy && !rename.isPending}
            error={nameError || undefined}
            helper={!nameError && !canRename ? "Reach this server to rename it." : undefined}
            onSubmitEditing={() => urlRef.current?.focus()}
          />
          <Input
            ref={urlRef}
            label="Address"
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
            editable={!busy && !rename.isPending}
            error={probeCopy.error}
            helper={probeCopy.helper}
            onSubmitEditing={() => void submit()}
          />
        </View>
        <PanelActions
          confirmLabel={confirmLabel}
          onConfirm={() => void submit()}
          onCancel={close}
          loading={busy || rename.isPending}
          confirmDisabled={confirmDisabled}
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
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[10],
    borderRadius: radius.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  currentBody: { flex: 1, minWidth: 0 },
  currentUrl: { marginTop: spacing[2] },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    flexShrink: 0,
  },
  fields: { gap: spacing[16] },
  hostChange: { gap: spacing[6], paddingHorizontal: spacing[8] },
});
