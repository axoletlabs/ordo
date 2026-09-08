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
import { ShareIntentProvider } from "expo-share-intent";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { queryClient } from "../src/lib/query-client";
import { useAuthStore } from "../src/store/auth";
import { useSettingsStore } from "../src/store/settings";
import { useFolderTokenStore } from "../src/store/folder-tokens";
import { useOnlineStore, useOnline } from "../src/lib/online";
import { scheduleProactiveRefresh } from "../src/lib/api/client";
import { ToastHost } from "../src/components/ui/ToastHost";
import { OverlayHost } from "../src/components/ui/overlay-host";
import { Banner } from "../src/components/ui/Banner";
import { UpdateReadyWatcher } from "../src/components/UpdateReadyWatcher";
import { NativeUpdateProgress } from "../src/components/NativeUpdateProgress";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { LaunchSplash } from "../src/components/LaunchSplash";
import { fontAssets } from "../src/theme/tokens";
import { IncomingShareHandler } from "../src/components/IncomingShareHandler";
import { AddBookmarkSheet } from "../src/components/bookmarks/AddBookmarkSheet";
import { returnToShareSender } from "../src/lib/share-target";
import { useIncomingShareStore } from "../src/store/incoming-share";
import {
  markRestartSplashPresented,
  useUpdateRestartStore,
} from "../src/store/update-restart";
import { enableFreeze } from "react-native-screens";

enableFreeze(true);

// Hold the native splash as early as possible so it covers JS load + hydration
// (otherwise its auto-hide leaves a white frame before React paints).
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 200, fade: true });

// Brand beat: keep the native splash up for at least this long once mounted.
const MIN_SPLASH_MS = 600;

function ConnectionBanner() {
  const online = useOnline();
  return (
    <Banner
      visible={!online}
      message="You're offline — some actions may be unavailable."
      tone="warning"
    />
  );
}

function RootShell() {
  const { palette } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const status = useAuthStore((s) => s.status);
  const tokens = useAuthStore((s) => s.tokens);
  const restarting = useUpdateRestartStore((s) => s.restarting);
  const sharedUrl = useIncomingShareStore((s) => s.pendingUrl);
  const clearSharedUrl = useIncomingShareStore((s) => s.clear);
  const [minElapsed, setMinElapsed] = React.useState(false);

  // Minimum brand display so the launch reads as intentional, not a flicker.
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

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

  // Schedule a proactive token refresh whenever the session changes.
  useEffect(() => {
    if (tokens?.expiresIn) scheduleProactiveRefresh(tokens.expiresIn);
  }, [tokens?.expiresIn, tokens?.accessToken]);

  // Keep the native splash visible while the redirect reconciles with auth so
  // the wrong group (e.g. login for an authenticated user) is never shown.
  const routeMatchesAuth =
    status !== "loading" &&
    (status === "authenticated" ? segments[0] === "(app)" : segments[0] === "(auth)");

  const showSplash = !routeMatchesAuth || !minElapsed;

  useEffect(() => {
    if (!showSplash) SplashScreen.hideAsync().catch(() => {});
  }, [showSplash]);

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
        <ConnectionBanner />
        <IncomingShareHandler />
        {!showSplash && !restarting && routeMatchesAuth && status === "authenticated" ? (
          <AddBookmarkSheet
            visible={!!sharedUrl}
            onDismiss={() => {
              clearSharedUrl();
              returnToShareSender();
            }}
            folderId={null}
            allowFolderSelection
            initialUrl={sharedUrl ?? undefined}
          />
        ) : null}
        <UpdateReadyWatcher />
        <NativeUpdateProgress />
      </OverlayHost>
      <ToastHost />
      {(showSplash || restarting) && (
        <LaunchSplash
          transitionIn={restarting}
          onPresented={restarting ? markRestartSplashPresented : undefined}
        />
      )}
    </>
  );
}

export default function RootLayout() {
  const [booted, setBooted] = React.useState(false);

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
        useAuthStore.setState({ user: null, tokens: null, status: "unauthenticated" });
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  return (
    <ShareIntentProvider
      options={{ scheme: "com.axolet.ordo", resetOnBackground: false }}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
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
