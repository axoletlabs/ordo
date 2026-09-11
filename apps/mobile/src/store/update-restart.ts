import { Appearance } from "react-native";
import { create } from "zustand";
import * as Updates from "expo-updates";
import { pinSystemChrome } from "../theme/pin-system-chrome";
import { resolvePalette } from "../theme/theme";
import { useSettingsStore } from "./settings";

const SPLASH_PRESENT_TIMEOUT_MS = 1500;

interface UpdateRestartState {
  restarting: boolean;
}

export const useUpdateRestartStore = create<UpdateRestartState>(() => ({
  restarting: false,
}));

let resolveRestartSplash: (() => void) | null = null;

/** Confirm that React committed the fallback before the native runtime reloads. */
export function markRestartSplashPresented(): void {
  const resolve = resolveRestartSplash;
  resolveRestartSplash = null;
  resolve?.();
}

function currentPalette() {
  const { themeMode, amoled } = useSettingsStore.getState();
  return resolvePalette(themeMode, amoled, Appearance.getColorScheme());
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Paint the branded fallback before replacing the JS runtime. */
export async function restartRuntime(beforeReload?: () => Promise<void>): Promise<void> {
  if (useUpdateRestartStore.getState().restarting) {
    await beforeReload?.();
    return;
  }

  const palette = currentPalette();
  await pinSystemChrome(palette);

  const splashPresented = new Promise<void>((resolve) => {
    resolveRestartSplash = resolve;
  });
  useUpdateRestartStore.setState({ restarting: true });
  await Promise.race([
    splashPresented,
    new Promise<void>((resolve) => setTimeout(resolve, SPLASH_PRESENT_TIMEOUT_MS)),
  ]);
  resolveRestartSplash = null;

  try {
    await beforeReload?.();
    // Re-pin after the overlay commits so StatusBar unmount restores this
    // chrome, not the light splash color expo-splash-screen stamps on Android.
    await pinSystemChrome(palette);
    await nextFrame();
    await Updates.reloadAsync();
  } catch (error) {
    resolveRestartSplash = null;
    useUpdateRestartStore.setState({ restarting: false });
    throw error;
  }
}

export function restartForUpdate(): Promise<void> {
  return restartRuntime();
}
