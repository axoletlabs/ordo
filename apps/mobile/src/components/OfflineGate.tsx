/**
 * Blocks the app when there is no device network, or when the configured
 * server cannot be reached. Settings → Server stays usable so the host can
 * be changed.
 */
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useOnline } from "../lib/online";
import { isServerUnreachable, subscribeServerUnreachable } from "../lib/server-availability";
import { qk } from "../lib/api/query-keys";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";
import { useServerInfo } from "../hooks/queries";
import { useTheme } from "../theme/ThemeProvider";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { spacing } from "../theme/tokens";

export function OfflineGate() {
  const online = useOnline();
  const { palette } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const qc = useQueryClient();
  const authStatus = useAuthStore((s) => s.status);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const serverInfo = useServerInfo();
  const onServerSettings = segments.join("/").includes("settings/server");
  const confirmedDown = useRef(false);
  const probedUrl = useRef(serverUrl);
  if (probedUrl.current !== serverUrl) {
    probedUrl.current = serverUrl;
    confirmedDown.current = false;
  }
  if (isServerUnreachable(serverInfo.error)) confirmedDown.current = true;
  else if (serverInfo.data && !serverInfo.isError && !serverInfo.isFetching) {
    confirmedDown.current = false;
  }

  useEffect(() => {
    return subscribeServerUnreachable(() => {
      void qc.invalidateQueries({ queryKey: qk.serverInfo(serverUrl) });
    });
  }, [qc, serverUrl]);

  if (!online) {
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

  const serverDown =
    authStatus === "authenticated" &&
    !onServerSettings &&
    (isServerUnreachable(serverInfo.error) || confirmedDown.current);

  if (!serverDown) return null;

  return (
    <View
      accessibilityViewIsModal
      accessibilityRole="alert"
      accessibilityLabel="Can't reach the server."
      pointerEvents="auto"
      style={[styles.root, { backgroundColor: palette.background }]}
    >
      <EmptyState
        icon="cloud-offline-outline"
        title="Can't reach the server"
        message="ordo needs your server to be online. Try again, or pick a different server."
        action={
          <View style={styles.actions}>
            <Button
              block
              label="Retry"
              onPress={() => {
                void serverInfo.refetch().then((result) => {
                  if (result.data) void qc.invalidateQueries();
                });
              }}
              loading={serverInfo.isFetching}
            />
            <Button
              block
              label="Change server"
              variant="ghost"
              onPress={() => router.push("/settings/server")}
            />
          </View>
        }
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
  actions: { width: "100%", gap: spacing[8] },
});
