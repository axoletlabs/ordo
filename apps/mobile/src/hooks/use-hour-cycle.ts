import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { Calendar } from "expo-localization";
import { localeUses12HourTime } from "../lib/time-input";

// Optional lookup keeps OTA bundles safe on older APKs without this module.
const localization = Platform.OS === "web" ? null : requireOptionalNativeModule<{
  getCalendars: () => Calendar[];
  addListener: (event: string, callback: () => void) => { remove: () => void };
}>("ExpoLocalization");

function readHour12() {
  const uses24hourClock = localization?.getCalendars()[0]?.uses24hourClock;
  return uses24hourClock == null ? localeUses12HourTime() : !uses24hourClock;
}

/** Honor the OS clock toggle, including changes while the app is backgrounded. */
export function useHourCycle() {
  const [hour12, setHour12] = useState(readHour12);
  useEffect(() => {
    const update = () => setHour12(readHour12());
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    const settings = localization?.addListener("onCalendarSettingsChanged", update);
    if (Platform.OS === "web") window.addEventListener("languagechange", update);
    return () => {
      appState.remove(); settings?.remove();
      if (Platform.OS === "web") window.removeEventListener("languagechange", update);
    };
  }, []);
  return hour12;
}
