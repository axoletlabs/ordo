/**
 * Top-level error boundary. Catches render errors anywhere in the tree and
 * shows a small themed fallback instead of a blank/white screen.
 *
 * Retry remounts the current JS tree. Reload never applies a *different*
 * pending OTA — that is a separate, explicit action.
 */
import React, { Component, type ReactNode } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  View,
  useColorScheme,
} from "react-native";
import * as Updates from "expo-updates";
import * as SplashScreen from "expo-splash-screen";
import { radius, resolveFont } from "../theme/tokens";
import { Text } from "./ui/Text";
import { Button } from "./ui/Button";
import { ThemeOverrideProvider } from "../theme/ThemeProvider";
import { resolvePalette } from "../theme/theme";
import { useDeviceColors } from "../theme/device-colors";
import { useSettingsStore } from "../store/settings";
import { reloadRuntime } from "../store/update-restart";

const RELEASES_URL = "https://github.com/axoletlabs/ordo/releases";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function Fallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const scheme = useColorScheme();
  const { themeMode, amoled, materialYouColors, expressive, themeContrast } = useSettingsStore();
  const deviceColors = useDeviceColors();
  const palette = resolvePalette(themeMode, amoled, scheme, undefined, expressive, themeContrast, materialYouColors ? deviceColors : null);
  const updates = Updates.useUpdates();
  const pendingId = updates.downloadedUpdate?.updateId;
  const runningId = updates.currentlyRunning.updateId;
  const pendingIsDifferent =
    updates.isUpdatePending && pendingId != null && pendingId !== runningId;
  const runningOta = Updates.isEnabled && !updates.currentlyRunning.isEmbeddedLaunch;
  const emergency = updates.currentlyRunning.isEmergencyLaunch;

  const reloadCurrent = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    if (pendingIsDifferent) {
      onReset();
      return;
    }
    void reloadRuntime().catch(onReset);
  };

  return (
    <ThemeOverrideProvider palette={palette}>
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={[styles.card, { backgroundColor: palette.surfaceContainerHigh }]}>
        <Text variant="headlineSmall" align="center">Something went wrong</Text>
        <Text variant="bodyMedium" color="secondary" align="center" style={styles.message}>
          {emergency
            ? "The last update failed to launch, so this is the version built into the app."
            : pendingIsDifferent
              ? "Retry keeps the version you're on. Applying the downloaded update is a separate step."
              : "An unexpected error occurred. Retrying usually fixes it."}
        </Text>
        <Text variant="bodySmall" color="danger" style={styles.details} selectable>
          {error.message || error.name}
        </Text>
        <View style={styles.actions}>
          <Button label="Retry" style={styles.button} onPress={onReset} />
          {pendingIsDifferent ? (
            <Button label="Apply update" variant="secondary" style={styles.button} onPress={() => void reloadRuntime().catch(onReset)} />
          ) : (
            <Button label="Reload" variant="secondary" style={styles.button} onPress={reloadCurrent} />
          )}
        </View>
        {runningOta ? (
          <Button label="Restore bundled app" variant="ghost" style={styles.link} onPress={() => void Linking.openURL(RELEASES_URL).catch(() => {})} />
        ) : null}
      </View>
    </View>
    </ThemeOverrideProvider>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("Unhandled render error:", error, info.componentStack);
    SplashScreen.hideAsync().catch(() => {});
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return <Fallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, alignItems: "stretch", padding: 24, borderRadius: radius["2xl"] },
  message: { marginTop: 16 },
  details: {
    marginTop: 12,
    fontFamily: resolveFont("mono", "400"),
    textAlign: "center",
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 24 },
  button: { flex: 1 },
  link: { marginTop: 16 },
});
