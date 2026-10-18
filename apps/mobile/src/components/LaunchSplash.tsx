import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Logo, SPLASH_LOGO_WIDTH } from "./ui/Logo";
import { peekRestartCover } from "../store/update-restart";
import { useTheme } from "../theme/ThemeProvider";
import { OtaLaunchProgress } from "./OtaLaunchProgress";
import type { OtaLaunchPhase } from "../lib/automatic-ota-update";
import { spacing } from "../theme/tokens";
import { isolateModal } from "../lib/modal-isolation";

interface LaunchSplashProps {
  onPresented?: () => void;
  update?: { phase: NonNullable<OtaLaunchPhase>; progress?: number };
}

/** React fallback matching the native splash for JS reloads and handoff gaps. */
export function LaunchSplash({ onPresented, update }: LaunchSplashProps) {
  const { palette } = useTheme();
  const { height } = useWindowDimensions();
  const root = useRef<View>(null);
  const updating = !!update;
  const cover = peekRestartCover();
  const backgroundColor = cover?.background ?? palette.background;
  const mode = cover?.mode ?? palette.mode;

  useLayoutEffect(() => {
    if (!updating || Platform.OS !== "web" || !root.current) return;
    return isolateModal(root.current as unknown as HTMLElement);
  }, [updating]);

  useEffect(() => {
    if (!onPresented) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(onPresented);
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [onPresented]);

  return (
    <View
      ref={root}
      testID="launch-splash"
      pointerEvents="auto"
      accessibilityElementsHidden={!update}
      accessibilityViewIsModal={updating}
      importantForAccessibility={update ? "auto" : "no-hide-descendants"}
      collapsable={false}
      style={[styles.root, { backgroundColor }]}
    >
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Logo width={SPLASH_LOGO_WIDTH} />
      {update ? (
        <View style={[styles.update, height < 500 && styles.compactUpdate]}>
          <OtaLaunchProgress phase={update.phase} progress={update.progress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  update: {
    position: "absolute",
    top: "50%",
    marginTop: spacing[64],
    width: "100%",
    paddingHorizontal: spacing[24],
    alignItems: "center",
  },
  compactUpdate: { position: "relative", top: 0, marginTop: spacing[24] },
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    elevation: 1000,
  },
});
