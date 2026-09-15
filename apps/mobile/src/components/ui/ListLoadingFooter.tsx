import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { Spinner } from "./Spinner";

/** Footer spinner for fetch-next. Idle height stays 1px so hiding it cannot loop onEndReached. */
export function ListLoadingFooter({ loading }: { loading: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={loading ? styles.footer : styles.idle} pointerEvents="none">
      {loading ? <Spinner color={palette.accent} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  idle: { height: 1 },
  footer: {
    paddingVertical: spacing[20],
    alignItems: "center",
    justifyContent: "center",
  },
});
