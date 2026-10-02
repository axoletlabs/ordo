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
import { FloatingPanel } from "../ui/FloatingPanel";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { PanelActions } from "../ui/SheetActionRow";
import { useSettingsStore } from "../../store/settings";
import { useServerProbe } from "../../hooks/use-server-probe";
import { probeServer } from "../../lib/server-probe";

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
      onDismiss={onDismiss}
      dismissible={!confirming}
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

        <PanelActions confirmLabel="Change" onConfirm={onChange} onCancel={onDismiss}
          loading={confirming} cancelDisabled={confirming}
          confirmDisabled={!submitEnabled || (animateReadyColor && (!up || probing))} />
      </ThemedScrollView>
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  body: {},
});
