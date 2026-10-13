/** Native stacks own native motion; web native-stack needs an explicit transition. */
import React, { useCallback, useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useMaterialMotion } from "../../theme/material-motion";
import { useSettingsStore } from "../../store/settings";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<View>(null);
  const { reducedMotion } = useMaterialMotion();
  const preference = useSettingsStore((state) => state.navigationAnimation);
  const settings = useRef({ reducedMotion, preference });
  settings.current = { reducedMotion, preference };
  const active = useRef<Animation | undefined>(undefined);
  useEffect(() => {
    if (reducedMotion || preference === "instant") active.current?.cancel();
  }, [reducedMotion, preference]);
  useFocusEffect(useCallback(() => {
    const { reducedMotion, preference } = settings.current;
    if (Platform.OS !== "web" || reducedMotion || preference === "instant") return;
    const node = ref.current as unknown as HTMLElement | null;
    // No filled transform remains on the input ancestors after the transition.
    const animation = node?.animate?.([
      { opacity: 0.6, transform: preference === "slide" ? "translateX(24px)" : "none" },
      { opacity: 1, transform: "none" },
    ], { duration: 250, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    active.current = animation;
    return () => { animation?.cancel(); active.current = undefined; };
    // Preferences affect the NEXT navigation, not an already-focused settings
    // page. Otherwise choosing a transition replays that page's entrance.
  }, []));
  return <View ref={ref} style={{ flex: 1 }}>{children}</View>;
}
