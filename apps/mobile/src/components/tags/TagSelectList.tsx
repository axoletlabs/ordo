/**
 * Scrollable list of the user's tags with checkmarks for selection and an
 * inline "New tag" affordance. Shared by the save sheet and edit-tags sheet.
 */
import React, { useMemo, useState } from "react";
import { Keyboard, StyleSheet, View, type TextInput } from "react-native";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { type TagColor } from "@ordo/shared";
import { Text } from "../ui/Text";
import { Input } from "../ui/Input";
import { PressableScale } from "../ui/PressableScale";
import { ContextMenuItem } from "../ui/ContextMenu";
import { useTags, useCreateTag } from "../../hooks/use-tags";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { tagColorValue } from "../../lib/tag-colors";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { toast } from "../ui/toast-store";
import { errorMessage } from "../../lib/error-message";

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
  /** Let a dropdown host take the search field's focus when it opens. */
  searchInputRef?: React.Ref<TextInput>;
  /** Native opening focus is owned by the hosting overlay's focus scope;
   * web pickers leave this false and run their own scoped focus take. */
  searchAutoFocus?: boolean;
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
  searchInputRef,
  searchAutoFocus,
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
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't create the tag. Try again."));
    }
  };

  const renderRow = (tag: { id: string; name: string; color: TagColor }, selected: boolean) => menu ? (
    // Dropdowns share menu selection colors/shape in both design modes; the
    // standalone checklist below deliberately keeps its list-selection roles.
    <ContextMenuItem
      key={tag.id}
      label={tag.name}
      labelLines={1}
      leading={<View style={[styles.dot, { backgroundColor: tagColorValue(tag.color).dot }]} />}
      selected={selected}
      selectionRole="menuitemcheckbox"
      onPress={() => onToggle(tag.id)}
    />
  ) : (
    <PressableScale
      key={tag.id}
      accessibilityRole="checkbox"
      accessibilityLabel={tag.name}
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
    menu && autoCreate && (query.trim() || onRequestCreateTag) ? (
      <ContextMenuItem
        label={query.trim() ? `Create “${query.trim()}”` : "New tag"}
        labelLines={1}
        leading={<View style={[styles.dot, { backgroundColor: palette.accent }]} />}
        trailing={<Ionicons name={query.trim() ? "add" : "chevron-forward"} size={18} color={palette.onSurfaceVariant} />}
        busy={!!query.trim() && create.isPending}
        onPress={() => {
          if (query.trim()) void createAndSelect(query.trim());
          else { Keyboard.dismiss(); onRequestCreateTag?.(); }
        }}
      />
    ) : autoCreate && query.trim() ? (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Create tag ${query.trim()}`}
        disabled={create.isPending}
        accessibilityState={{ busy: create.isPending }}
        style={styles.row}
        onPress={() => void createAndSelect(query.trim())}
      >
        <View style={[styles.dot, { backgroundColor: palette.accent }]} />
        <Text variant="body" color="accent" numberOfLines={1} style={{ flex: 1 }}>
          Create “{query.trim()}”
        </Text>
        <Ionicons name="add" size={18} color={palette.accent} />
      </PressableScale>
    ) : autoCreate && onRequestCreateTag ? (
      <PressableScale
        accessibilityRole="button"
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
      <Input ref={searchInputRef} value={query} onChangeText={setQuery} variant="search" placeholder="Find a tag" accessibilityLabel="Find a tag"
        autoFocus={searchAutoFocus} containerStyle={{ flexShrink: 0 }} icon={<Ionicons name="search-outline" size={24} color={palette.onSurfaceVariant} />} />
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
