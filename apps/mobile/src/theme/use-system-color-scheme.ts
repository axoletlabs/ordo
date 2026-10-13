import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

function subscribe(onChange: () => void) {
  const subscription = Appearance.addChangeListener(onChange);
  return () => subscription.remove();
}

/**
 * Keep the real device appearance as an external-store snapshot. RN Web's
 * useColorScheme resubscribes after each render and can miss a scheme event
 * during a simultaneous reduced-motion change; a snapshot closes that gap.
 * Never write Appearance here: independent reader/app palettes are consumers.
 */
export function useSystemColorScheme() {
  return useSyncExternalStore(subscribe, Appearance.getColorScheme, () => null);
}
