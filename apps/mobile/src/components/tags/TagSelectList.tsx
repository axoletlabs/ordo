/**
 * Scrollable list of the user's tags with checkmarks for selection and an
 * inline "New tag" affordance. Shared by the save sheet and edit-tags sheet.
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type TagColor } from "@ordo/shared";
import { Text } from "../ui/Text";
import { Input } from "../ui/Input";
import { PressableScale } from "../ui/PressableScale";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { useTags, useCreateTag } from "../../hooks/use-tags";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
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
}

export function TagSelectList({
  selectedIds,
  onToggle,
  extraTags = [],
  maxHeight,
  autoCreate = true,
  onRequestCreateTag,
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
      selected: filtered.filter((t) => selectedIds.includes(t.id)),
      unselected: filtered.filter((t) => !selectedIds.includes(t.id)),
    };
  }, [catalogue, extraTags, query, selectedIds]);

  const listHeight = maxHeight ?? Math.min(300, height * 0.42);

  const createAndSelect = async (name: string) => {
    try {
      const tag = await create.mutateAsync({ name });
      onToggle(tag.id);
    } catch {
      // Best-effort quick create; failures surface via the host sheet's toast.
    }
  };

  const renderRow = (tag: { id: string; name: string; color: TagColor }, selected: boolean) => (
    <PressableScale
      key={tag.id}
      accessibilityRole="button"
      accessibilityLabel={`${tag.name}${selected ? ", selected" : ""}`}
      accessibilityState={{ selected }}
      style={styles.row}
      onPress={() => onToggle(tag.id)}
    >
      <View style={[styles.dot, { backgroundColor: tagColorValue(tag.color).dot }]} />
      <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
        {tag.name}
      </Text>
      {selected ? <Ionicons name="checkmark" size={18} color={palette.accent} /> : null}
    </PressableScale>
  );

  return (
    <View>
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Filter tags…"
        autoCapitalize="none"
        autoCorrect={false}
        icon={<Ionicons name="search-outline" size={18} color={palette.textTertiary} />}
      />
      <ThemedFlatList
        data={[...tags.selected, ...tags.unselected]}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => renderRow(item, selectedIds.includes(item.id))}
        style={{ maxHeight: listHeight }}
        ListEmptyComponent={
          <Text variant="footnote" color="secondary" style={styles.empty}>
            {query ? `No tags match "${query}".` : "No tags yet."}
          </Text>
        }
        ListFooterComponent={
          autoCreate && query.trim() ? (
            <PressableScale
              accessibilityRole="button"
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
              accessibilityRole="button"
              accessibilityLabel="New tag"
              style={styles.row}
              onPress={() => onRequestCreateTag?.()}
            >
              <View style={[styles.dot, { backgroundColor: palette.accent }]} />
              <Text variant="body" color="accent">
                New tag
              </Text>
              <Ionicons name="chevron-forward" size={16} color={palette.textFaint} />
            </PressableScale>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 44,
    paddingVertical: spacing[8],
  },
  dot: { width: 10, height: 10, borderRadius: 9999 },
  empty: { paddingVertical: spacing[12] },
});
