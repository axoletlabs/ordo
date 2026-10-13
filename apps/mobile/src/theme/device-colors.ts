/** Android 12+ Material You palettes; refresh when returning from system settings. */
import { useSyncExternalStore } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import type { DeviceTonalFamily, DeviceTonalPalettes } from "./material-colors";

interface MaterialColorsNative { get(): Promise<DeviceTonalPalettes | null> }
const native = Platform.OS === "android" ? NativeModules.OrdoMaterialColors as MaterialColorsNative | undefined : undefined;
export const materialYouAvailable = Platform.OS === "android" && Number(Platform.Version) >= 31 && typeof native?.get === "function";
let current: DeviceTonalPalettes | null = null;
export function currentDeviceColors() { return current; }

function validPalettes(value: DeviceTonalPalettes | null): value is DeviceTonalPalettes {
  return !!value && ["accent1", "accent2", "accent3", "neutral1", "neutral2"].every((key) => {
    const tones = value[key as DeviceTonalFamily];
    return tones && ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "95", "99", "100"].every((tone) => /^#[0-9a-f]{6}$/i.test(tones[tone] ?? ""));
  });
}

export function useDeviceColors() {
  return useSyncExternalStore(subscribe, currentDeviceColors, currentDeviceColors);
}

// Theme, reader, and error boundary share one native read and foreground
// subscription. Mounting a reader must not re-read 100+ Android resources.
const subscribers = new Set<() => void>();
let listener: ReturnType<typeof AppState.addEventListener> | null = null;
let refreshing = false;
let fingerprint = "";
async function refresh() {
  if (refreshing || !materialYouAvailable) return;
  refreshing = true;
  try {
    const next = await native!.get();
    if (!validPalettes(next)) return;
    const nextFingerprint = JSON.stringify(next);
    if (nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;
    current = next;
    subscribers.forEach((notify) => notify());
  } catch { /* An older APK or unsupported device keeps the app palette. */ }
  finally { refreshing = false; }
}
function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (materialYouAvailable && subscribers.size === 1) {
    if (!current) void refresh();
    listener = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
  }
  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) { listener?.remove(); listener = null; }
  };
}
