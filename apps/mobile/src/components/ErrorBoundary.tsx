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
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import * as Updates from "expo-updates";
import * as SplashScreen from "expo-splash-screen";

const RELEASES_URL = "https://github.com/axoletlabs/ordo/releases";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function Fallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const dark = useColorScheme() === "dark";
  const foreground = dark ? "#F4F1E8" : "#24231F";
  const secondary = dark ? "#AAA79F" : "#656159";
  const background = dark ? "#11110F" : "#EFE7D2";
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
    void Updates.reloadAsync().catch(onReset);
  };

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <View style={styles.card}>
        <Text style={[styles.title, { color: foreground }]}>Something went wrong</Text>
        <Text style={[styles.message, { color: secondary }]}>
          {emergency
            ? "The last update failed to launch, so this is the version built into the app."
            : pendingIsDifferent
              ? "Retry keeps the version you're on. Applying the downloaded update is a separate step."
              : "An unexpected error occurred. Retrying usually fixes it."}
        </Text>
        <Text style={styles.details} selectable>
          {error.message || error.name}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            style={[styles.button, styles.primaryButton]}
            onPress={onReset}
          >
            <Text style={[styles.buttonLabel, styles.primaryButtonLabel]}>Retry</Text>
          </Pressable>
          {pendingIsDifferent ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.button, { borderColor: secondary }]}
              onPress={() => void Updates.reloadAsync().catch(onReset)}
            >
              <Text style={[styles.buttonLabel, { color: foreground }]}>Apply update</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              style={[styles.button, { borderColor: secondary }]}
              onPress={reloadCurrent}
            >
              <Text style={[styles.buttonLabel, { color: foreground }]}>Reload</Text>
            </Pressable>
          )}
        </View>
        {runningOta ? (
          <Pressable
            accessibilityRole="button"
            style={styles.link}
            onPress={() => void Linking.openURL(RELEASES_URL).catch(() => {})}
          >
            <Text style={[styles.linkLabel, { color: secondary }]}>
              Restore the bundled app from GitHub
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
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
  card: { width: "100%", maxWidth: 360, alignItems: "stretch" },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700", textAlign: "center" },
  message: { marginTop: 8, fontSize: 16, lineHeight: 23, textAlign: "center" },
  details: { marginTop: 12, color: "#D95D4F", fontSize: 12, lineHeight: 17, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 24 },
  button: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  primaryButton: { backgroundColor: "#EF705F", borderColor: "#EF705F" },
  buttonLabel: { fontSize: 14, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase" },
  primaryButtonLabel: { color: "#FFFFFF" },
  link: { marginTop: 16, minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkLabel: { fontSize: 13, lineHeight: 18, textAlign: "center" },
});
