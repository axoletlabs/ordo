/** Native stacks own native motion; web native-stack needs an explicit transition. */
import React, { useCallback, useRef } from "react";
import { Platform, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useMaterialMotion } from "../../theme/material-motion";
import { useSettingsStore } from "../../store/settings";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<View>(null);
  const { reducedMotion } = useMaterialMotion();
  const preference = useSettingsStore((state) => state.navigationAnimation);
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web" || reducedMotion || preference === "instant") return;
    const node = ref.current as unknown as HTMLElement | null;
    // No filled transform remains on the input ancestors after the transition.
    const animation = node?.animate?.([
      { opacity: 0.6, transform: preference === "slide" ? "translateX(24px)" : "none" },
      { opacity: 1, transform: "none" },
    ], { duration: 250, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    return () => animation?.cancel();
  }, [preference, reducedMotion]));
  return <View ref={ref} style={{ flex: 1 }}>{children}</View>;
}
