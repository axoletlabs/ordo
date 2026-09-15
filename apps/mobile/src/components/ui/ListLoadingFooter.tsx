import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { Spinner } from "./Spinner";

/** Shown only while fetch-next is in flight — do not mount an idle spacer. */
export function ListLoadingFooter() {
  const { palette } = useTheme();
  return (
    <View style={styles.footer} pointerEvents="none">
      <Spinner color={palette.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingVertical: spacing[20],
    alignItems: "center",
    justifyContent: "center",
  },
});
