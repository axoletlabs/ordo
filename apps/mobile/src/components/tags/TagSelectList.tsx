/**
 * Scrollable list of the user's tags with checkmarks for selection and an
 * inline "New tag" affordance. Shared by the save sheet and edit-tags sheet.
 */
import React, { useMemo, useState } from "react";
import { Keyboard, Platform, StyleSheet, View, type PressableProps } from "react-native";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { type TagColor } from "@ordo/shared";
import { Text } from "../ui/Text";
import { Input } from "../ui/Input";
import { PressableScale } from "../ui/PressableScale";
import { useTags, useCreateTag } from "../../hooks/use-tags";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { tagColorValue } from "../../lib/tag-colors";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";

export interface TagSelectListProps {
  /** Currently selected tag ids (assignment or draft). */
  selectedIds: readonly string[];
  onToggle: (tagId: string) => void;
  /** Extra tag summaries not present in the catalogue (e.g. suggestions). */
  extraTags?: Array<{ id: string; name: string; color: TagColor }>;
  maxHeight?: number;
  autoCreate?: boolean;
  /**
   * FloatingPanel hosting this list — a nested overlay is fine, but the
   * create-tag panel is still rendered by the caller so the list stays simple.
   */
  onRequestCreateTag?: () => void;
  header?: React.ReactNode;
  menu?: boolean;
}

export function TagSelectList({
  selectedIds,
  onToggle,
  extraTags = [],
  maxHeight,
  autoCreate = true,
  onRequestCreateTag,
  header,
  menu = false,
}: TagSelectListProps) {
  const { palette } = useTheme();
  const { height } = useResponsiveLayout();
  const { data: catalogue } = useTags();
  const create = useCreateTag();
  const [query, setQuery] = useState("");

  const tags = useMemo(() => {
    const known = new Map<string, { id: string; name: string; color: TagColor }>();
    for (const tag of [...(catalogue ?? []), ...extraTags]) {
      if (!known.has(tag.id)) known.set(tag.id, tag);
    }
    const all = [...known.values()];
    const q = query.trim().toLocaleLowerCase("en-US");
    const filtered = q
      ? all.filter((t) => t.name.toLocaleLowerCase("en-US").includes(q))
      : all;
    return {
      all: filtered,
      selected: filtered.filter((t) => selectedIds.includes(t.id)),
      unselected: filtered.filter((t) => !selectedIds.includes(t.id)),
    };
  }, [catalogue, extraTags, query, selectedIds]);

  const listHeight = maxHeight ?? Math.min(300, height * 0.42);

  const createAndSelect = async (name: string) => {
    if (create.isPending) return;
    Keyboard.dismiss();
    try {
      const tag = await create.mutateAsync({ name });
      onToggle(tag.id);
      setQuery("");
    } catch {
      // Best-effort quick create; failures surface via the host sheet's toast.
    }
  };

  const renderRow = (tag: { id: string; name: string; color: TagColor }, selected: boolean) => (
    <PressableScale
      key={tag.id}
      accessibilityRole="checkbox"
      {...(menu && Platform.OS === "web" ? { role: "menuitemcheckbox" as PressableProps["role"] } : null)}
      accessibilityLabel={`${tag.name}${selected ? ", selected" : ""}`}
      accessibilityState={{ checked: selected }}
      stateLayerColor={selected ? palette.onSecondaryContainer : palette.onSurface}
      style={[styles.row, { backgroundColor: selected ? palette.secondaryContainer : "transparent" }]}
      onPress={() => onToggle(tag.id)}
    >
      <View style={[styles.dot, { backgroundColor: tagColorValue(tag.color).dot }]} />
      <Text variant="bodyLarge" numberOfLines={1} style={{ flex: 1, color: selected ? palette.onSecondaryContainer : palette.onSurface }}>
        {tag.name}
      </Text>
      {selected ? <Ionicons name="checkmark" size={24} color={palette.onSecondaryContainer} /> : null}
    </PressableScale>
  );

  const createRow =
    autoCreate && query.trim() ? (
      <PressableScale
        accessibilityRole={menu ? "menuitem" : "button"}
        accessibilityLabel={`Create tag ${query.trim()}`}
        style={styles.row}
        onPress={() => void createAndSelect(query.trim())}
      >
        <View style={[styles.dot, { backgroundColor: palette.accent }]} />
        <Text variant="body" color="accent" numberOfLines={1} style={{ flex: 1 }}>
          Create “{query.trim()}”
        </Text>
        <Ionicons name="add" size={18} color={palette.accent} />
      </PressableScale>
    ) : autoCreate ? (
      <PressableScale
        accessibilityRole={menu ? "menuitem" : "button"}
        accessibilityLabel="New tag"
        style={styles.row}
        onPress={() => {
          Keyboard.dismiss();
          onRequestCreateTag?.();
        }}
      >
        <View style={[styles.dot, { backgroundColor: palette.accent }]} />
        <Text variant="body" color="accent">
          New tag
        </Text>
        <Ionicons name="chevron-forward" size={16} color={palette.textFaint} />
      </PressableScale>
    ) : null;

  return (
    <View style={{ flexShrink: 1, gap: spacing[8] }}>
      <Input value={query} onChangeText={setQuery} variant="search" placeholder="Find a tag" accessibilityLabel="Find a tag"
        containerStyle={{ flexShrink: 0 }} icon={<Ionicons name="search-outline" size={24} color={palette.onSurfaceVariant} />} />
    <ThemedFlatList animateChanges
      data={menu ? tags.all : [...tags.selected, ...tags.unselected]}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => renderRow(item, selectedIds.includes(item.id))}
      style={{ maxHeight: listHeight, flexShrink: 1 }}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      ListHeaderComponent={header ? <View>{header}</View> : undefined}
      ListEmptyComponent={
        <Text variant="footnote" color="secondary" style={styles.empty}>
          {query ? `No tags match "${query}".` : "No tags yet."}
        </Text>
      }
      ListFooterComponent={createRow}
    />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 48,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[8],
  },
  dot: { width: 7, height: 7, borderRadius: 9999 },
  empty: { paddingVertical: spacing[12] },
});
