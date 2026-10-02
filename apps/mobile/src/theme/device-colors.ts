/** Android 12+ Material You palettes; refresh when returning from system settings. */
import { useEffect, useState } from "react";
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
  const [colors, setColors] = useState(current);
  useEffect(() => {
    if (!materialYouAvailable) return;
    let alive = true;
    const refresh = async () => {
      try {
        const next = await native!.get();
        if (!alive || !validPalettes(next)) return;
        current = next;
        setColors((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      } catch { /* An older APK or unsupported device keeps the app palette. */ }
    };
    void refresh();
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    return () => { alive = false; listener.remove(); };
  }, []);
  return colors;
}
