/**
 * Terminal-style floating "Connect to server" dialog.
 *
 * A monospace health-check log runs a live 2-step probe (connect → /api/server/info)
 * as the user types (debounced). The Change button stays disabled until the probe
 * reports `up`; clicking it runs one quick re-probe, then commits.
 *
 * Crucially, the probe runs in isolation and NEVER mutates the global server-URL
 * store — only the final commit does. (The previous version mutated the store to
 * probe, which is what broke Save / reset the URL.)
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { ServerProbeLog } from "../ui/ServerProbeLog";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, radius, resolveFont, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { useSettingsStore } from "../../store/settings";
import {
  hostOf,
  normalizeServerUrl,
  probeServer,
  type ProbeStep,
} from "../../lib/server-probe";
import { visibleServerHistory } from "../../lib/server-history";
import { timeAgo } from "../../lib/format";

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
          <ActivityIndicator size="small" color={palette.onAccent} />
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
  /** Cross-fade the Change button grey → accent once verification passes (auth flow). */
  animateReadyColor?: boolean;
}

export function ServerConnectSheet({
  visible,
  onDismiss,
  onSaved,
  animateReadyColor = false,
}: ServerConnectSheetProps) {
  const { palette } = useTheme();
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const serverHistory = useSettingsStore((s) => s.serverHistory);
  const recents = visibleServerHistory(serverHistory, currentUrl);

  const [url, setUrl] = useState(currentUrl);
  const [steps, setSteps] = useState<ProbeStep[]>([]);
  const [probing, setProbing] = useState(false);
  const [up, setUp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset only when the sheet opens (NOT on currentUrl changes).
  useEffect(() => {
    if (visible) {
      setUrl(currentUrl);
      setSteps([]);
      setProbing(false);
      setUp(false);
      setConfirming(false);
    }
  }, [visible]);

  // Debounced probe whenever the (normalised) URL changes.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const normalized = normalizeServerUrl(url);
    if (!normalized || normalized === normalizeServerUrl(currentUrl)) {
      setSteps([]);
      setUp(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (cancelled) return;
      setProbing(true);
      setUp(false);
      void probeServer(url, (s) => {
        if (!cancelled) setSteps(s);
      }).then((r) => {
        if (cancelled) return;
        setProbing(false);
        setUp(r.status === "up");
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

  const onChange = async () => {
    if (!normalized || !canChange) return;
    setConfirming(true);
    const recheck = await probeServer(normalized);
    setConfirming(false);
    if (recheck.status === "up" && recheck.url) {
      await setServerUrl(recheck.url);
      onDismiss();
      onSaved?.();
    } else {
      // Refresh the log to show the failure detail.
      setUp(false);
      void probeServer(normalized, (s) => setSteps(s));
    }
  };

  return (
    <FloatingPanel visible={visible} onDismiss={confirming ? () => {} : onDismiss}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <PanelHeader
        icon="cloud-outline"
        iconColor={palette.blue}
        iconBackground="rgba(79,125,166,0.14)"
        title="Server URL"
      />

      <Input
        value={url}
        onChangeText={setUrl}
        placeholder="http://localhost:3000"
        mono
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        icon={<Ionicons name="link" size={15} color={palette.textTertiary} />}
      />

      {/* Recents fill the URL so the existing health check still has to pass. */}
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
                    backgroundColor: selected ? palette.accentSoft : palette.surfaceSecondary,
                    borderColor: selected ? palette.accent : "transparent",
                  },
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={selected ? palette.accent : palette.textTertiary}
                />
                <View style={styles.recentCopy}>
                  <Text variant="subhead" numberOfLines={1} color={selected ? "accent" : "primary"}>
                    {hostOf(entry.url)}
                  </Text>
                  <Text variant="monoSmall" color="tertiary" numberOfLines={1}>
                    {timeAgo(new Date(entry.lastConnectedAt).toISOString())}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </View>
      ) : null}

      {/* Terminal log */}
      {!isUnchanged ? (
        <ServerProbeLog steps={steps} probing={probing} />
      ) : null}

      {/* Current hint */}
      {!isUnchanged && currentUrl ? (
        <View style={styles.currentRow}>
          <Ionicons name="time-outline" size={11} color={palette.textTertiary} />
          <Text variant="monoSmall" color="tertiary" numberOfLines={1} style={{ flex: 1 }}>
            Current: {hostOf(currentUrl)}
          </Text>
        </View>
      ) : null}

      {/* Actions */}
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
      </ScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  recents: { marginTop: spacing[10], gap: spacing[6] },
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
  currentRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing[8] },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    marginTop: spacing[12],
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
