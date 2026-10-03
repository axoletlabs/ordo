import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { Button } from "../ui/Button";
import { MaterialIcon } from "../ui/MaterialIcon";
import { PressableScale } from "../ui/PressableScale";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import type { FolderDto } from "@ordo/shared";

export function FolderPickerPanel({ visible, onDismiss, folders, value, onChange, onCreate }: {
  visible: boolean; onDismiss: () => void; folders: readonly FolderDto[]; value: string | null;
  onChange: (folderId: string | null) => void; onCreate: () => void;
}) {
  const { palette } = useTheme();
  const [query, setQuery] = useState("");
  const options = useMemo(() => [{ id: null as string | null, name: "Bookmarks", icon: "bookmark-outline" as const, protected: false }, ...folders]
    .filter((folder) => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [folders, query]);
  return <FloatingPanel visible={visible} onDismiss={onDismiss} scrollBody={false}>
    <PanelHeader title="Save to" onClose={onDismiss} />
    <View style={{ flexShrink: 1, gap: spacing[8] }}>
      <Input variant="search" value={query} onChangeText={setQuery} placeholder="Find a folder" accessibilityLabel="Find a folder"
        icon={<MaterialIcon name="search" />} />
      <ThemedFlatList animateChanges data={options} keyExtractor={(folder) => folder.id ?? "root"}
        style={{ maxHeight: 280, flexShrink: 1 }} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text variant="bodyMedium" color="secondary" style={{ padding: spacing[16] }}>No folders match.</Text>}
        renderItem={({ item }) => <PressableScale accessibilityRole="radio" accessibilityState={{ checked: item.id === value }}
          accessibilityLabel={item.name} onPress={() => { onChange(item.id); onDismiss(); }}
          style={{ minHeight: 56, paddingHorizontal: spacing[12], flexDirection: "row", alignItems: "center", gap: spacing[12], borderRadius: radius.md,
            backgroundColor: item.id === value ? palette.secondaryContainer : "transparent" }}>
          <MaterialIcon name={item.icon} color={item.id === value ? palette.onSecondaryContainer : palette.onSurfaceVariant} />
          <Text variant="bodyLarge" numberOfLines={1} style={{ flex: 1, color: item.id === value ? palette.onSecondaryContainer : palette.onSurface }}>{item.name}</Text>
          {item.protected ? <MaterialIcon name="lock-closed" size={18} /> : null}
          {item.id === value ? <MaterialIcon name="checkmark" color={palette.onSecondaryContainer} /> : null}
        </PressableScale>} />
      <Button label="New folder" variant="tonal" onPress={onCreate} icon={<MaterialIcon name="add" />} />
    </View>
  </FloatingPanel>;
}
