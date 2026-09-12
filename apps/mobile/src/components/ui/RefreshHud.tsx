/**
 * Website reload chip. Lists hide the OS RefreshControl spinner and draw
 * this instead so pull-to-refresh matches the in-app browser.
 */
import React, { useCallback, useState } from "react";
import {
  RefreshControl,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  browserPtrHudOffset,
  browserPtrHudOpacity,
} from "../../lib/in-app-browser";
import { listRefreshHudDy, listRefreshOverscrollDy } from "../../lib/list-refresh";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { ReloadSpinner } from "./Spinner";

export function RefreshHud({
  dy,
  refreshing,
}: {
  dy: number;
  refreshing: boolean;
}) {
  const { palette } = useTheme();
  const opacity = browserPtrHudOpacity(dy, refreshing);
  const offset = browserPtrHudOffset(dy);
  if (opacity <= 0) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.ptrHud, { opacity, transform: [{ translateY: offset }] }]}
    >
      <ReloadSpinner
        color={palette.accent}
        backgroundColor={palette.surfaceElevated}
        borderColor={palette.borderStrong}
      />
    </View>
  );
}

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

export function useBrandedRefresh(
  refreshing: boolean | null | undefined,
  onRefresh: (() => void) | null | undefined,
  refreshControl?: React.ReactElement,
) {
  const [ptrDy, setPtrDy] = useState(0);
  const onScroll = useCallback((event: ScrollEvent) => {
    const next = listRefreshOverscrollDy(event.nativeEvent.contentOffset.y);
    setPtrDy((prev) => (Math.abs(prev - next) < 2 ? prev : next));
  }, []);

  const enabled = !refreshControl && (refreshing != null || onRefresh != null);
  if (!enabled) {
    return { refreshControl, hud: null as React.ReactNode, onScroll: undefined };
  }

  return {
    refreshControl: onRefresh ? (
      <RefreshControl
        refreshing={false}
        onRefresh={onRefresh ?? undefined}
        tintColor="transparent"
        colors={["#00000000"]}
        progressBackgroundColor="#00000000"
        progressViewOffset={-256}
      />
    ) : undefined,
    hud: (
      <RefreshHud dy={listRefreshHudDy(!!refreshing, ptrDy)} refreshing={!!refreshing} />
    ),
    onScroll,
  };
}

const styles = StyleSheet.create({
  ptrHud: {
    position: "absolute",
    top: spacing[8],
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2,
  },
});
