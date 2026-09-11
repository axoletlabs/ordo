/**
 * Floating "Connect to server" dialog.
 *
 * A live health check runs as the user types (debounced). Change stays
 * disabled until the probe reports the server is up; clicking it re-probes,
 * then commits.
 *
 * The probe runs in isolation and never mutates the global server-URL store —
 * only the final commit does.
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Spinner } from "../ui/Spinner";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, radius, resolveFont, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { useSettingsStore } from "../../store/settings";
import {
  describeProbeField,
  hostOf,
  normalizeServerUrl,
  probeServer,
} from "../../lib/server-probe";
import { visibleServerHistory } from "../../lib/server-history";
import { timeAgo } from "../../lib/format";
import type { ServerInfoDto } from "@ordo/shared";

/**
 * Change button that sits greyed-out (neutral fill + muted label) until the
 * probe reports the server is up, then cross-fades to the coral accent fill.
 * Opt-in via the `animateReadyColor` prop (auth flow only).
 */
function AnimatedChangeButton({
  ready,
  loading,
  disabled,
  onPress,
}: {
  ready: boolean;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(ready ? 1 : 0, { duration: 420 });
  }, [ready, progress]);

  const bg = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [
      palette.surfaceSecondary,
      palette.accent,
    ]),
  }));

  const fg = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [
      palette.textTertiary,
      palette.onAccent,
    ]),
  }));

  return (
    <PressableScale
      disabled={disabled || loading}
      onPress={() => {
        haptics.light();
        onPress();
      }}
      style={[styles.changeBtn, { height: 42, borderRadius: radius.sm, overflow: "hidden" }]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { borderRadius: radius.sm }, bg]}
        pointerEvents="none"
      />
      <View style={styles.changeContent}>
        {loading ? (
          <Spinner size="sm" color={palette.onAccent} />
        ) : (
          <Animated.Text
            style={[
              {
                fontFamily: resolveFont("display", "600"),
                fontSize: fontSize.lg,
                fontWeight: "600",
                letterSpacing: 1.4,
                textTransform: "uppercase",
              },
              fg,
            ]}
          >
            Change
          </Animated.Text>
        )}
      </View>
    </PressableScale>
  );
}

export interface ServerConnectSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSaved?: () => void;
  /** Prefill when the sheet opens. Defaults to the current server URL. */
  initialUrl?: string;
  /**
   * Called with a verified origin instead of writing the URL immediately.
   * Server settings uses this so it can confirm sign-out first.
   */
  onCommit?: (url: string) => void | Promise<void>;
  /** Cross-fade the Change button grey → accent once verification passes (auth flow). */
  animateReadyColor?: boolean;
}

export function ServerConnectSheet({
  visible,
  onDismiss,
  onSaved,
  initialUrl,
  onCommit,
  animateReadyColor = false,
}: ServerConnectSheetProps) {
  const { palette } = useTheme();
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const serverHistory = useSettingsStore((s) => s.serverHistory);
  const recents = visibleServerHistory(serverHistory, currentUrl);
  const inputRef = useRef<TextInput>(null);

  const [url, setUrl] = useState(initialUrl ?? currentUrl);
  const [probing, setProbing] = useState(false);
  const [up, setUp] = useState(false);
  const [probeDetail, setProbeDetail] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<Pick<ServerInfoDto, "name" | "version"> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset only when the sheet opens (NOT on currentUrl changes).
  useEffect(() => {
    if (visible) {
      setUrl(initialUrl ?? currentUrl);
      setProbing(false);
      setUp(false);
      setProbeDetail(null);
      setProbeInfo(null);
      setConfirming(false);
    }
  }, [visible]);

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
      void probeServer(url).then((r) => {
        if (cancelled) return;
        setProbing(false);
        setUp(r.status === "up");
        setProbeDetail(r.detail ?? null);
        setProbeInfo(r.info ?? null);
      });
    }, 900);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [url, visible, currentUrl]);

  const normalized = normalizeServerUrl(url);
  const isUnchanged = !normalized || normalized === normalizeServerUrl(currentUrl);
  const canChange = !!normalized && !isUnchanged && up && !probing && !confirming;
  const probeCopy = describeProbeField({
    idle: isUnchanged,
    probing,
    reachable: up,
    detail: probeDetail,
    info: probeInfo,
  });

  const onChange = async () => {
    if (!normalized || !canChange) return;
    setConfirming(true);
    const recheck = await probeServer(normalized);
    setConfirming(false);
    if (recheck.status === "up" && recheck.url) {
      if (onCommit) {
        await onCommit(recheck.url);
      } else {
        await setServerUrl(recheck.url);
        onSaved?.();
      }
      onDismiss();
    } else {
      setUp(false);
      setProbeDetail(recheck.detail ?? null);
      setProbeInfo(null);
    }
  };

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={confirming ? () => {} : onDismiss}
      onShow={() => {
        setTimeout(() => inputRef.current?.focus(), 100);
      }}
    >
      <ThemedScrollView keyboardShouldPersistTaps="handled">
      <PanelHeader
        icon="cloud-outline"
        iconColor={palette.blue}
        title="Server URL"
        subtitle="Address of your self-hosted Ordo server."
      />

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
        editable={!confirming}
        error={probeCopy.error}
        helper={probeCopy.helper}
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
                disabled={confirming}
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
                  <Text variant="subhead" numberOfLines={1} color={selected ? "accent" : "primary"}>
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

      <View style={styles.actions}>
        <Button
          label="Cancel"
          variant="secondary"
          onPress={onDismiss}
          disabled={confirming}
          style={styles.action}
        />
        {animateReadyColor ? (
          <View style={styles.action}>
            <AnimatedChangeButton
              ready={up && !probing}
              loading={confirming}
              disabled={!canChange}
              onPress={onChange}
            />
          </View>
        ) : (
          <Button
            label={confirming ? "" : "Change"}
            variant="primary"
            onPress={onChange}
            disabled={!canChange}
            loading={confirming}
            style={styles.action}
          />
        )}
      </View>
      </ThemedScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  recents: { marginTop: spacing[12], gap: spacing[6] },
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
  changeBtn: {
    paddingHorizontal: spacing[20],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  changeContent: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
