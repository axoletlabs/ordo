/** The exact copyright, license and NOTICE text supplied with each component. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SettingsPage, SettingsScrollView } from "../../../src/components/settings/SettingsPage";
import { Text } from "../../../src/components/ui/Text";
import { getLicenseCatalog } from "../../../src/lib/open-source-licenses";
import { layout, spacing } from "../../../src/theme/tokens";

export default function LicenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const catalog = React.useMemo(getLicenseCatalog, []);
  const entry = id === "ordo" ? catalog.ordo : catalog.entries.find((item) => item.id === id);

  return (
    <SettingsPage title={id === "ordo" ? "Ordo license" : "License details"}>
      <SettingsScrollView>
        <View style={styles.content}>
          {entry ? <>
            <View style={styles.heading}>
              <Text variant="headlineSmall" accessibilityRole="header" selectable>{entry.name}</Text>
              <Text variant="bodyMedium" color="secondary" selectable>
                {[entry.version, entry.license].filter(Boolean).join(" · ")}
              </Text>
            </View>
            {entry.notices.map((notice, index) => (
              <View key={`${notice.title}-${index}`} style={styles.notice}>
                <Text variant="titleMedium" accessibilityRole="header">{notice.title}</Text>
                <Text variant="bodyMedium" selectable>{notice.text}</Text>
              </View>
            ))}
          </> : <>
            <Text variant="titleMedium">License not found</Text>
            <Text variant="bodyMedium" color="secondary">Go back to open source licenses and choose a component.</Text>
          </>}
        </View>
      </SettingsScrollView>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.rowInset, paddingTop: spacing[8], gap: spacing[24] },
  heading: { gap: spacing[8] },
  notice: { gap: spacing[12] },
});
