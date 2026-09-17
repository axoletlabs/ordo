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
import { FloatingPanel } from "../ui/FloatingPanel";
import { Spinner } from "../ui/Spinner";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { PressableScale } from "../ui/PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, radius, resolveFont, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { useSettingsStore } from "../../store/settings";
import { useServerProbe } from "../../hooks/use-server-probe";
import { probeServer } from "../../lib/server-probe";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";

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
    borderColor: interpolateColor(progress.value, [0, 1], [
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
      style={styles.changeBtn}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { borderRadius: radius.sm, borderWidth: 1 }, bg]}
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
  const currentUrl = useSettingsStore((s) => s.serverUrl);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const inputRef = useRef<TextInput>(null);

  const [url, setUrl] = useState(initialUrl ?? currentUrl);
  const [confirming, setConfirming] = useState(false);
  const probe = useServerProbe(url, currentUrl, visible);

  // Reset only when the sheet opens (NOT on currentUrl changes).
  useEffect(() => {
    if (visible) {
      setUrl(initialUrl ?? currentUrl);
      setConfirming(false);
    }
  }, [visible]);

  const { normalized, canChange, probeCopy, probing, up } = probe;
  const submitEnabled = canChange && !confirming;

  const onChange = async () => {
    if (!normalized || !submitEnabled) return;
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
      probe.setUp(false);
      probe.setProbeDetail(recheck.detail ?? null);
      probe.setProbeInfo(null);
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
        <PanelHeader title="Server address" />

        <View style={styles.body}>
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
        </View>

        <View style={styles.actions}>
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              dismissKeyboard();
              onDismiss();
            }}
            disabled={confirming}
            style={styles.action}
          />
          {animateReadyColor ? (
            <View style={styles.action}>
              <AnimatedChangeButton
                ready={up && !probing}
                loading={confirming}
                disabled={!submitEnabled}
                onPress={onChange}
              />
            </View>
          ) : (
            <Button
              label={confirming ? "" : "Change"}
              variant="primary"
              onPress={onChange}
              disabled={!submitEnabled}
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
  body: {},
  actions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing[8],
    marginTop: spacing[12],
  },
  action: { flex: 1, minWidth: 0 },
  changeBtn: {
    height: 42,
    borderRadius: radius.sm,
    overflow: "hidden",
    paddingHorizontal: spacing[16],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  changeContent: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
