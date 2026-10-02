/** Material search app bar: search is an action, account is a trailing destination. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { useAuthStore } from "../../store/auth";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import { MaterialIcon } from "../ui/MaterialIcon";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { UserAvatar } from "../ui/UserAvatar";
import { SelectionHeader } from "./SelectionHeader";

export function LibraryHeader({ tools, selection }: { tools: React.ReactNode; selection?: {
  count: number; selectableCount: number; onCancel: () => void; onToggleSelectAll: () => void;
} }) {
  const { palette, expressive } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(layout.maxContentWidth);
  const user = useAuthStore((s) => s.user);
  return <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center",
    paddingTop: insets.top + spacing[8], paddingLeft: column.left, paddingRight: column.right }}>
    {selection ? <SelectionHeader {...selection} embedded /> : <View style={styles.appBar}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Search your library"
        accessibilityHint="Opens search and focuses the search field."
        onPress={() => router.navigate("/search")} stateLayerColor={palette.onSurface}
        style={[styles.search, { backgroundColor: palette.surfaceContainerHigh }]}>
        <MaterialIcon name="search-outline" size={24} color={palette.onSurfaceVariant} />
        <Text variant="bodyLarge" color="secondary" numberOfLines={1} style={{ flex: 1 }}>Search your library</Text>
      </PressableScale>
      <PressableScale accessibilityRole="button" accessibilityLabel="Account and settings"
        onPress={() => router.navigate("/settings")} style={[styles.account, { backgroundColor: palette.secondaryContainer }]}>
        {user ? <UserAvatar user={user} size={40} /> : <MaterialIcon name="person-circle-outline" size={28} color={palette.onSecondaryContainer} />}
      </PressableScale>
    </View>}
    <View style={styles.titleRow}>
      <Text variant={expressive ? "displaySmall" : "headlineLarge"}>Your library</Text>
    </View>
    <View style={[styles.toolbar, { backgroundColor: palette.surfaceContainer, borderRadius: expressive ? radius["2xl"] : radius.full }]}>
      <Text variant="labelLarge" color="secondary" style={{ flex: 1, paddingLeft: spacing[16] }}>{selection ? "Hold and drag to select more" : "Library tools"}</Text>
      {!selection ? tools : null}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  appBar: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  search: { flex: 1, minWidth: 0, minHeight: 56, borderRadius: radius.full, flexDirection: "row", alignItems: "center", gap: spacing[16], paddingHorizontal: spacing[16] },
  account: { width: 48, height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  titleRow: { paddingTop: spacing[24], paddingBottom: spacing[16] },
  toolbar: { minHeight: 56, flexDirection: "row", alignItems: "center", padding: spacing[4], marginBottom: spacing[16] },
});
