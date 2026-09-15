import { Appearance, Image } from "react-native";
import { create } from "zustand";
import * as Updates from "expo-updates";
import { createMMKV, type MMKV } from "react-native-mmkv";
import LOGO_MARK from "../../assets/logo-mark.png";
import {
  buildReloadScreenOptions,
  parseRestartCover,
  serializeRestartCover,
  type RestartCover,
  type RuntimeReloadScreenOptions,
} from "../lib/runtime-restart";
import { pinSystemChrome } from "../theme/pin-system-chrome";
import { resolvePalette } from "../theme/theme";
import { useSettingsStore } from "./settings";

const SPLASH_PRESENT_TIMEOUT_MS = 1500;
const COVER_KEY = "restartCover";

interface UpdateRestartState {
  restarting: boolean;
}

export const useUpdateRestartStore = create<UpdateRestartState>(() => ({
  restarting: false,
}));

let resolveRestartSplash: (() => void) | null = null;
let coverStorage: MMKV | null | undefined;

function getCoverStorage(): MMKV | null {
  if (coverStorage !== undefined) return coverStorage;
  try {
    coverStorage = createMMKV({ id: "ordo-runtime" });
  } catch {
    coverStorage = null;
  }
  return coverStorage;
}

export function rememberRestartCover(
  cover: Pick<RestartCover, "background" | "mode">,
  at = Date.now(),
): void {
  getCoverStorage()?.set(COVER_KEY, serializeRestartCover(cover, at));
}

/** Sync read so the first paint after reload can match the native cover. */
export function peekRestartCover(now = Date.now()): RestartCover | null {
  return parseRestartCover(getCoverStorage()?.getString(COVER_KEY), now);
}

export function clearRestartCover(): void {
  getCoverStorage()?.remove(COVER_KEY);
}

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

function reloadImageUri(): string | undefined {
  try {
    return Image.resolveAssetSource(LOGO_MARK)?.uri ?? undefined;
  } catch {
    return undefined;
  }
}

export function reloadScreenOptionsForPalette(backgroundColor: string): RuntimeReloadScreenOptions {
  return buildReloadScreenOptions(backgroundColor, reloadImageUri());
}

/** Replace the JS runtime with a themed reload screen (no Expo white spinner). */
export async function reloadRuntime(palette = currentPalette()): Promise<void> {
  rememberRestartCover({ background: palette.background, mode: palette.mode });
  await pinSystemChrome(palette);
  await Updates.reloadAsync({
    reloadScreenOptions: reloadScreenOptionsForPalette(palette.background),
  });
}

/** Paint the branded fallback before replacing the JS runtime. */
export async function restartRuntime(beforeReload?: () => Promise<void>): Promise<void> {
  if (useUpdateRestartStore.getState().restarting) {
    await beforeReload?.();
    return;
  }

  const palette = currentPalette();
  rememberRestartCover({ background: palette.background, mode: palette.mode });
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
    await Updates.reloadAsync({
      reloadScreenOptions: reloadScreenOptionsForPalette(palette.background),
    });
  } catch (error) {
    resolveRestartSplash = null;
    useUpdateRestartStore.setState({ restarting: false });
    clearRestartCover();
    throw error;
  }
}

export function restartForUpdate(): Promise<void> {
  return restartRuntime();
}
