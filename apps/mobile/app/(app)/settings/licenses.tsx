/** Searchable, virtualized acknowledgments. Every notice is bundled offline. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { SettingsPage } from "../../../src/components/settings/SettingsPage";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Text } from "../../../src/components/ui/Text";
import { Input } from "../../../src/components/ui/Input";
import { IconButton } from "../../../src/components/ui/IconButton";
import { MaterialIcon } from "../../../src/components/ui/MaterialIcon";
import { ThemedFlatList } from "../../../src/components/ui/ThemedScrollView";
import { useAppRouter } from "../../../src/hooks/use-app-router";
import { useColumnPadding } from "../../../src/hooks/use-scene-column-insets";
import { getLicenseCatalog } from "../../../src/lib/open-source-licenses";
import { layout, spacing } from "../../../src/theme/tokens";

export default function LicensesScreen() {
  const router = useAppRouter();
  const column = useColumnPadding(layout.maxSettingsWidth);
  const [query, setQuery] = React.useState("");
  const { entries } = React.useMemo(getLicenseCatalog, []);
  const search = query.trim().toLocaleLowerCase();
  const filtered = React.useMemo(() => entries.filter((entry) =>
    `${entry.name} ${entry.license}`.toLocaleLowerCase().includes(search)), [entries, search]);

  return (
    <SettingsPage title="Open source licenses">
      <ThemedFlatList
        data={filtered}
        keyExtractor={(entry) => entry.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={styles.list}
        contentContainerStyle={[styles.content, styles.column,
          { paddingLeft: column.left, paddingRight: column.right }]}
        ListHeaderComponent={
          <View style={styles.intro}>
            <Text variant="bodyLarge" color="secondary">Ordo is built with the work of open source communities. Explore their licenses and acknowledgments below.</Text>
            <Input variant="search" placeholder="Search libraries or licenses" accessibilityLabel="Search libraries or licenses"
              value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false}
              icon={<MaterialIcon name="search" size={24} />}
              rightAccessory={query ? <IconButton name="close" variant="standard" accessibilityLabel="Clear search" onPress={() => setQuery("")} /> : undefined} />
            <Text variant="bodySmall" color="secondary" accessibilityLiveRegion="polite">
              {search ? `${filtered.length} of ${entries.length} components` : `${entries.length} components · Available offline`}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <SettingRow label={item.name} labelLines={0} description={[item.version, item.license].filter(Boolean).join(" · ")}
            position={filtered.length === 1 ? "only" : index === 0 ? "first" : index === filtered.length - 1 ? "last" : "middle"}
            onPress={() => router.push({ pathname: "/settings/license", params: { id: item.id } })} showChevron />
        )}
        ListEmptyComponent={<View style={styles.empty}>
          <Text variant="titleMedium">No matching components</Text>
          <Text variant="bodyMedium" color="secondary">Try a library name or a license such as MIT.</Text>
        </View>}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingBottom: spacing[40] },
  // Shares the header's centered settings column; the rail padding alone
  // would hug the window edge on wide web while the title stays inset.
  column: { width: "100%", maxWidth: layout.maxSettingsWidth, alignSelf: "center" },
  intro: { gap: spacing[16], paddingHorizontal: layout.rowInset, paddingTop: spacing[8], paddingBottom: spacing[24] },
  empty: { gap: spacing[8], padding: layout.rowInset },
});
