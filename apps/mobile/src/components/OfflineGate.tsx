/**
 * Blocks the app when there is no device network, or when the configured
 * server cannot be reached. Settings → Hosting stays usable so the host can
 * be changed.
 */
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useOverlayPresence } from "../hooks/use-overlay-presence";
import { useOverlayFocus } from "../hooks/use-overlay-focus";
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
import { isCloudServerUrl } from "../lib/hosting";
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
  // Bundled legal notices and app information remain readable without a server.
  const offlineReadable = ["settings/about", "settings/licenses", "settings/license", "settings/build-details"]
    .some((path) => segments.join("/").endsWith(path));
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

  const serverDown = authStatus === "authenticated" && !onServerSettings &&
    (isServerUnreachable(serverInfo.error) || confirmedDown.current);
  // Bundled about/licence screens stay readable: the gate never mounts there.
  const visible = !offlineReadable && (!online || serverDown);
  const focusRef = useOverlayFocus(visible, () => {}, "dialog", false, true);
  const lastReason = useRef<"offline" | "server">("offline");
  if (visible) lastReason.current = !online ? "offline" : "server";
  const { rendered, progress } = useOverlayPresence(visible, () => {}, { interactive: false, dismissKeyboard: false });
  const fade = useAnimatedStyle(() => ({ opacity: progress.value }));
  useLayoutEffect(() => {
    if (Platform.OS === "web" && focusRef.current) (focusRef.current as unknown as HTMLElement).inert = !visible;
  }, [visible, rendered, focusRef]);
  if (!rendered) return null;

  if (lastReason.current === "offline") {
    return (
      <Animated.View
        ref={focusRef}
        {...(Platform.OS === "web" ? { tabIndex: -1, "aria-modal": visible, role: "alertdialog" as const, dataSet: { materialOverlay: String(visible) } } : {})}
        accessibilityViewIsModal={visible}
        accessibilityRole="alert"
        accessibilityLabel="You're offline. Connect to a network to use ordo."
        pointerEvents={visible ? "auto" : "none"}
        aria-hidden={!visible}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
        style={[styles.root, { backgroundColor: palette.background }, fade]}
      >
        <EmptyState
          icon="cloud-offline-outline"
          title="You're offline"
          message="ordo needs a network connection. Connect to a network to continue."
          action={authStatus === "authenticated" ? (
            <Button label="About Ordo" variant="ghost" onPress={() => router.push("/settings/about")} />
          ) : undefined}
        />
      </Animated.View>
    );
  }

  const cloud = isCloudServerUrl(serverUrl);
  const title = cloud ? "Can't reach ordo Cloud" : "Can't reach your server";
  const message = cloud
    ? "ordo needs ordo Cloud to be online. Try again in a moment."
    : "ordo needs your server to be online. Try again, or open Hosting to pick another.";

  return (
    <Animated.View
      ref={focusRef}
      {...(Platform.OS === "web" ? { tabIndex: -1, "aria-modal": visible, role: "alertdialog" as const, dataSet: { materialOverlay: String(visible) } } : {})}
      accessibilityViewIsModal={visible}
      accessibilityRole="alert"
      accessibilityLabel={title}
      pointerEvents={visible ? "auto" : "none"}
      aria-hidden={!visible}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={[styles.root, { backgroundColor: palette.background }, fade]}
    >
      <EmptyState
        icon="cloud-offline-outline"
        title={title}
        message={message}
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
              label="Hosting"
              variant="ghost"
              onPress={() => router.push("/settings/server")}
            />
            <Button block label="About Ordo" variant="ghost" onPress={() => router.push("/settings/about")} />
          </View>
        }
      />
    </Animated.View>
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
