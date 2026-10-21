import React, { useMemo, useRef, useState } from "react";
import { Platform, View, type TextInput } from "react-native";
import { ContextMenu, ContextMenuItem, type MenuAnchorRect } from "../ui/ContextMenu";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { MaterialIcon } from "../ui/MaterialIcon";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { spacing } from "../../theme/tokens";
import type { FolderDto } from "@ordo/shared";
import { useOpeningFocus } from "./use-opening-focus";

export function FolderPickerMenu({ visible, onDismiss, folders, value, onChange, onCreate, anchor }: {
  visible: boolean; onDismiss: () => void; folders: readonly FolderDto[]; value: string | null;
  onChange: (folderId: string | null) => void; onCreate: () => void;
  anchor: MenuAnchorRect | null;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<TextInput>(null);
  const contentRef = useRef<View>(null);
  // Native pickers delegate opening focus to the shared Input focus scope:
  // the ContextMenu publishes active/ready once it has measured, and a fresh
  // per-open session takes focus through the field's own autoFocus request.
  // Web has no native IME/scope handoff, so it keeps this explicit take:
  // cancelled on dismissal, unmount, or deliberate pointer/key navigation.
  const openingFocus = useOpeningFocus({
    active: Platform.OS === "web" && visible,
    targetRef: searchRef,
    scopeRef: contentRef,
  });
  const options = useMemo(() => [{ id: null as string | null, name: "Bookmarks", icon: "bookmark-outline" as const, protected: false }, ...folders]
    .filter((folder) => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [folders, query]);
  return <ContextMenu visible={visible} onDismiss={onDismiss} anchor={anchor} width={anchor?.width} scrollBody={false} keyboardDismiss={false} estimatedHeight={320}>
    <View ref={contentRef} {...openingFocus} style={{ flexShrink: 1, gap: spacing[8], paddingHorizontal: spacing[16] }}>
      <Input ref={searchRef} variant="search" value={query} onChangeText={setQuery} placeholder="Find a folder" accessibilityLabel="Find a folder"
        autoFocus={Platform.OS !== "web"} containerStyle={{ flexShrink: 0 }} icon={<MaterialIcon name="search" />} />
      <ThemedFlatList animateChanges data={options} keyExtractor={(folder) => folder.id ?? "root"}
        style={{ maxHeight: 280, flexShrink: 1 }} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text variant="bodyMedium" color="secondary" style={{ padding: spacing[16] }}>No folders match.</Text>}
        renderItem={({ item }) => <ContextMenuItem selectionRole="menuitemradio" label={item.name} icon={item.icon}
          selected={item.id === value} trailing={item.protected ? <MaterialIcon name="lock-closed" size={18} /> : undefined}
          onPress={() => { onChange(item.id); onDismiss(); }} />} />
      <ContextMenuItem label="New folder" onPress={onCreate} icon="add" />
    </View>
  </ContextMenu>;
}
