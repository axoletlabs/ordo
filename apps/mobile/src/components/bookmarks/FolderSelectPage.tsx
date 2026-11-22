/**
 * Folder destination list for the save sheet's in-surface picker page.
 * A tap selects and returns; creation is a footer action that opens the
 * sheet's create page. Kept virtualized so large libraries stay cheap.
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { FolderDto, FolderIcon } from "@ordo/shared";
import { Input } from "../ui/Input";
import { MaterialIcon } from "../ui/MaterialIcon";
import { ListPressable } from "../ui/ListPressable";
import { Text } from "../ui/Text";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { useTheme } from "../../theme/ThemeProvider";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { listCorners, listPosition } from "../../theme/list-shape";
import { radius, spacing } from "../../theme/tokens";

type FolderOption = { id: string | null; name: string; icon: FolderIcon; protected: boolean };

export function FolderSelectPage({ folders, value, onSelect, onCreate }: {
  folders: readonly FolderDto[];
  value: string | null;
  onSelect: (folderId: string | null) => void;
  onCreate: () => void;
}) {
  const { palette, expressive } = useTheme();
  const { height } = useResponsiveLayout();
  const [query, setQuery] = useState("");
  const options = useMemo<FolderOption[]>(() => {
    const all: FolderOption[] = [
      { id: null, name: "Bookmarks", icon: "bookmark-outline", protected: false },
      ...folders.map((folder) => ({ id: folder.id, name: folder.name, icon: folder.icon, protected: folder.protected })),
    ];
    const needle = query.trim().toLocaleLowerCase();
    return needle ? all.filter((folder) => folder.name.toLocaleLowerCase().includes(needle)) : all;
  }, [folders, query]);
  const listHeight = Math.min(360, height * 0.5);

  return (
    <View style={styles.page}>
      <Input
        variant="search"
        value={query}
        onChangeText={setQuery}
        placeholder="Find a folder"
        accessibilityLabel="Find a folder"
        icon={<MaterialIcon name="search" />}
        containerStyle={{ flexShrink: 0 }}
      />
      <ThemedFlatList
        data={options}
        extraData={value}
        keyExtractor={(folder) => folder.id ?? "root"}
        style={{ maxHeight: listHeight, flexShrink: 1 }}
        accessibilityRole="radiogroup"
        accessibilityLabel="Folder"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <Text variant="bodyMedium" color="secondary" style={styles.empty}>
            {query.trim() ? "No folders match." : "No folders yet."}
          </Text>
        }
        ListFooterComponent={
          <ListPressable accessibilityRole="button" accessibilityLabel="New folder" style={styles.row} onPress={onCreate}>
            <MaterialIcon name="add" size={24} color={palette.accent} />
            <Text variant="bodyLarge" color="accent" style={{ flex: 1 }}>New folder</Text>
          </ListPressable>
        }
        renderItem={({ item, index }) => {
          const selected = item.id === value;
          const corners = listCorners(listPosition(index, options.length), selected);
          const foreground = selected ? palette.onSecondaryContainer : palette.onSurface;
          return (
            <ListPressable
              accessibilityRole="radio"
              accessibilityLabel={item.name}
              accessibilityState={{ checked: selected }}
              style={[styles.row, {
                ...(expressive ? corners : { borderRadius: 0 }),
                backgroundColor: selected ? palette.secondaryContainer : expressive ? palette.surfaceContainerLow : "transparent",
                marginBottom: expressive && index < options.length - 1 ? spacing[2] : 0,
              }]}
              onPress={() => onSelect(item.id)}
            >
              <MaterialIcon name={item.icon} size={24} color={selected ? palette.onSecondaryContainer : palette.onSurfaceVariant} />
              <Text variant="bodyLarge" numberOfLines={1} style={{ flex: 1, color: foreground }}>{item.name}</Text>
              {item.protected ? (
                <MaterialIcon name="lock-closed" size={18}
                  color={selected ? palette.onSecondaryContainer : palette.onSurfaceVariant} />
              ) : null}
              {selected ? <MaterialIcon name="checkmark" size={24} color={palette.onSecondaryContainer} /> : null}
            </ListPressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing[12] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 48,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  empty: { paddingVertical: spacing[12], paddingHorizontal: spacing[16] },
});
