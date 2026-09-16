/**
 * Root layout: installs providers (gesture, safe-area, query, theme), hydrates
 * persisted state, initialises connectivity, and gates navigation by auth status.
 *
 * Launch sequence: the native splash is held (expo-splash-screen) while fonts +
 * persisted stores hydrate and navigation reconciles with the auth status. It
 * is dismissed only after the correct route is ready and a minimum brand beat
 * has elapsed, so the native logo remains the same size for the whole launch.
 */
import React, { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import * as Updates from "expo-updates";
import { ShareIntentProvider } from "expo-share-intent";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { queryClient } from "../src/lib/query-client";
import { restoreQueryPersistence, stopQueryPersistence } from "../src/lib/query-cache";
import { useAuthStore } from "../src/store/auth";
import { useSettingsStore } from "../src/store/settings";
import { useFolderTokenStore } from "../src/store/folder-tokens";
import { useOnlineStore, useOnline } from "../src/lib/online";
import { cancelProactiveRefresh, ensureFreshAccessToken } from "../src/lib/api/client";
import { initAppLifecycle } from "../src/lib/app-lifecycle";
import { ToastHost } from "../src/components/ui/ToastHost";
import { OverlayHost } from "../src/components/ui/overlay-host";
import { OfflineGate } from "../src/components/OfflineGate";
import { UpdateReadyWatcher } from "../src/components/UpdateReadyWatcher";
import { NativeUpdateProgress } from "../src/components/NativeUpdateProgress";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { LaunchSplash } from "../src/components/LaunchSplash";
import { fontAssets } from "../src/theme/tokens";
import { IncomingShareHandler } from "../src/components/IncomingShareHandler";
import { AddBookmarkSheet } from "../src/components/bookmarks/AddBookmarkSheet";
import { returnToShareSender } from "../src/lib/share-target";
import { shareSavedToast } from "../src/lib/share-intake";
import { useIncomingShareStore } from "../src/store/incoming-share";
import {
  clearRestartCover,
  markRestartSplashPresented,
  peekRestartCover,
  useUpdateRestartStore,
} from "../src/store/update-restart";
import { enableFreeze } from "react-native-screens";

enableFreeze(true);
initAppLifecycle();

// Hold the native splash as early as possible so it covers JS load + hydration
// (otherwise its auto-hide leaves a white frame before React paints).
SplashScreen.preventAutoHideAsync().catch(() => {});
// A runtime reload already showed a matching cover; fading the native splash
// on top of it would shrink/dim the mark. Cold launch still fades.
SplashScreen.setOptions(
  peekRestartCover()
    ? { duration: 0, fade: false }
    : { duration: 200, fade: true },
);

// Brand beat: keep the native splash up for at least this long once mounted.
const MIN_SPLASH_MS = 600;

function RootShell() {
  const { palette } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const status = useAuthStore((s) => s.status);
  const tokens = useAuthStore((s) => s.tokens);
  const userId = useAuthStore((s) => s.user?.id);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const online = useOnline();
  const restarting = useUpdateRestartStore((s) => s.restarting);
  const { restartCount } = Updates.useUpdates();
  const runtimeRestart = restarting || restartCount > 0 || peekRestartCover() != null;
  const sharedUrl = useIncomingShareStore((s) => s.pendingUrl);
  const clearSharedUrl = useIncomingShareStore((s) => s.clear);
  const [minElapsed, setMinElapsed] = React.useState(runtimeRestart);

  // Minimum brand display so a cold launch reads as intentional, not a flicker.
  // Runtime reloads already spent that time under the matching cover.
  useEffect(() => {
    if (runtimeRestart) {
      setMinElapsed(true);
      return;
    }
    const t = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, [runtimeRestart]);

  // Gate navigation once status is resolved.
  useEffect(() => {
    if (status === "loading") return;
    const inAuthGroup = segments[0] === "(auth)";
    if (status === "unauthenticated" && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (status === "authenticated" && inAuthGroup) {
      router.replace("/(app)");
    }
  }, [status, segments, router]);

  // Keep the access token fresh while the app is in the foreground.
  useEffect(() => {
    if (status !== "authenticated") {
      cancelProactiveRefresh();
      return;
    }
    void ensureFreshAccessToken();
  }, [status, tokens?.accessToken]);

  useEffect(() => {
    if (status === "authenticated" && userId && online) {
      void restoreQueryPersistence(userId, serverUrl);
      return;
    }
    stopQueryPersistence();
  }, [status, userId, serverUrl, online]);

  // Keep the native splash visible while the redirect reconciles with auth so
  // the wrong group (e.g. login for an authenticated user) is never shown.
  const routeMatchesAuth =
    status !== "loading" &&
    (status === "authenticated" ? segments[0] === "(app)" : segments[0] === "(auth)");

  const showSplash = !routeMatchesAuth || !minElapsed;

  useEffect(() => {
    if (showSplash || restarting) return;
    SplashScreen.hideAsync().catch(() => {});
    clearRestartCover();
  }, [restarting, showSplash]);

  return (
    <>
      <OverlayHost>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
            animation: "fade",
            animationDuration: 260,
          }}
        >
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
        <IncomingShareHandler />
        {!showSplash && !restarting && routeMatchesAuth && status === "authenticated" ? (
          <AddBookmarkSheet
            visible={!!sharedUrl}
            onDismiss={() => {
              clearSharedUrl();
              returnToShareSender();
            }}
            onSaved={(destination) => {
              clearSharedUrl();
              returnToShareSender(shareSavedToast(destination));
            }}
            folderId={null}
            allowFolderSelection
            initialUrl={sharedUrl ?? undefined}
            shareIntake
          />
        ) : null}
        <UpdateReadyWatcher />
        <NativeUpdateProgress />
      </OverlayHost>
      <ToastHost />
      <OfflineGate />
      {(showSplash || restarting) && (
        <LaunchSplash
          onPresented={restarting ? markRestartSplashPresented : undefined}
        />
      )}
    </>
  );
}

export default function RootLayout() {
  const [booted, setBooted] = React.useState(false);
  const restartCover = peekRestartCover();

  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        Font.loadAsync(fontAssets),
        useSettingsStore.getState().hydrate(),
        useFolderTokenStore.getState().hydrate(),
        useOnlineStore.getState().init(),
      ]);

      for (const result of results) {
        if (result.status === "rejected") console.warn("App bootstrap task failed", result.reason);
      }

      try {
        await useAuthStore.getState().hydrate();
      } catch (error) {
        console.warn("Auth bootstrap failed", error);
        useAuthStore.setState({
          user: null,
          tokens: null,
          accessExpiresAt: null,
          sessionUpdatedAt: null,
          status: "unauthenticated",
        });
      }

      try {
        const auth = useAuthStore.getState();
        if (auth.status === "authenticated" && auth.user) {
          await restoreQueryPersistence(auth.user.id, useSettingsStore.getState().serverUrl);
        }
      } catch (error) {
        console.warn("Query cache restore failed", error);
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  return (
    <ShareIntentProvider
      options={{ scheme: "com.axolet.ordo", resetOnBackground: false }}
    >
      <GestureHandlerRootView
        style={{ flex: 1, backgroundColor: restartCover?.background }}
      >
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <ErrorBoundary>{booted ? <RootShell /> : <LaunchSplash />}</ErrorBoundary>
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}
