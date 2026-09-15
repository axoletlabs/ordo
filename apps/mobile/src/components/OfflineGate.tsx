/**
 * Blocks the whole app when the device has no network. Cached lists and
 * reader state must not be usable until a real offline mode exists.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useOnline } from "../lib/online";
import { useTheme } from "../theme/ThemeProvider";
import { EmptyState } from "./ui/EmptyState";

export function OfflineGate() {
  const online = useOnline();
  const { palette } = useTheme();
  if (online) return null;

  return (
    <View
      accessibilityViewIsModal
      accessibilityRole="alert"
      accessibilityLabel="You're offline. Connect to a network to use ordo."
      pointerEvents="auto"
      style={[styles.root, { backgroundColor: palette.background }]}
    >
      <EmptyState
        icon="cloud-offline-outline"
        title="You're offline"
        message="ordo needs a network connection. Connect to a network to continue."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 900,
    elevation: 900,
  },
});
