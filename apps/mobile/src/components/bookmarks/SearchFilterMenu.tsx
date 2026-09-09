/**
 * Nested floating filter menu for global search: tags, read status, and
 * article/website. Stays open while toggling tags so you can stack filters.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TagDto } from "@ordo/shared";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { tagColorValue } from "../../lib/tag-colors";
import { haptics } from "../../lib/haptics";
import { menuHoverFill, type MenuAnchorRect } from "../../lib/menu-anchor";
import { radius, spacing } from "../../theme/tokens";
import {
  EMPTY_SEARCH_FILTERS,
  searchFiltersActive,
  type SearchFilters,
  type SearchKindFilter,
  type SearchStatusFilter,
} from "../../lib/search-bookmarks";

type FilterPage = "root" | "tags" | "status" | "kind";

const STATUS_LABEL: Record<SearchStatusFilter, string> = {
  all: "Any",
  unread: "Unread",
  read: "Read",
};

const KIND_LABEL: Record<SearchKindFilter, string> = {
  all: "Any",
  article: "Articles",
  web: "Websites",
};

export function SearchFilterMenu({
  visible,
  onDismiss,
  anchor,
  tags,
  filters,
  onChange,
}: {
  visible: boolean;
  onDismiss: () => void;
  anchor: MenuAnchorRect | null;
  tags: readonly TagDto[];
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const { palette } = useTheme();
  const [page, setPage] = useState<FilterPage>("root");
  const [tagQuery, setTagQuery] = useState("");

  useEffect(() => {
    if (visible) return;
    setPage("root");
    setTagQuery("");
  }, [visible]);

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLocaleLowerCase("en-US");
    const list = q
      ? tags.filter((tag) => tag.name.toLocaleLowerCase("en-US").includes(q))
      : [...tags];
    return list.sort(
      (a, b) =>
        Number(filters.tagIds.includes(b.id)) - Number(filters.tagIds.includes(a.id)) ||
        b.bookmarkCount - a.bookmarkCount ||
        a.name.localeCompare(b.name),
    );
  }, [filters.tagIds, tagQuery, tags]);

  const go = (next: FilterPage) => {
    setPage(next);
  };

  const setStatus = (status: SearchStatusFilter) => {
    onChange({ ...filters, status });
    setPage("root");
  };

  const setKind = (kind: SearchKindFilter) => {
    onChange({ ...filters, kind });
    setPage("root");
  };

  const toggleTag = (tagId: string) => {
    onChange({
      ...filters,
      tagIds: filters.tagIds.includes(tagId)
        ? filters.tagIds.filter((id) => id !== tagId)
        : [...filters.tagIds, tagId],
    });
  };

  const clear = () => {
    onChange({ ...EMPTY_SEARCH_FILTERS, tagIds: [] });
    setPage("root");
  };

  const tagSummary =
    filters.tagIds.length === 0
      ? "Any"
      : filters.tagIds.length === 1
        ? (tags.find((tag) => tag.id === filters.tagIds[0])?.name ?? "1")
        : `${filters.tagIds.length}`;

  return (
    <ContextMenu visible={visible} onDismiss={onDismiss} anchor={anchor} width={280}>
      {page === "root" ? (
        <>
          {tags.length > 0 ? (
            <ContextMenuItem
              icon="pricetags-outline"
              label="Tags"
              trailing={<Trailing label={tagSummary} />}
              onPress={() => go("tags")}
            />
          ) : null}
          <ContextMenuItem
            icon="eye-outline"
            label="Status"
            trailing={<Trailing label={STATUS_LABEL[filters.status]} />}
            onPress={() => go("status")}
          />
          <ContextMenuItem
            icon="document-text-outline"
            label="Type"
            trailing={<Trailing label={KIND_LABEL[filters.kind]} />}
            onPress={() => go("kind")}
          />
          {searchFiltersActive(filters) ? (
            <ContextMenuItem icon="close-circle-outline" label="Clear filters" onPress={clear} />
          ) : null}
        </>
      ) : null}

      {page === "tags" ? (
        <>
          <ContextMenuItem icon="chevron-back" label="Back" onPress={() => go("root")} />
          {tags.length > 6 ? (
            <View style={styles.tagSearch}>
              <Input
                value={tagQuery}
                onChangeText={setTagQuery}
                placeholder="Filter tags…"
                autoCapitalize="none"
                autoCorrect={false}
                icon={<Ionicons name="search-outline" size={16} color={palette.textTertiary} />}
              />
            </View>
          ) : null}
          {filteredTags.length === 0 ? (
            <Text variant="footnote" color="secondary" style={styles.empty}>
              {tagQuery.trim() ? `No tags match “${tagQuery.trim()}”.` : "No tags yet."}
            </Text>
          ) : (
            filteredTags.map((tag) => {
              const selected = filters.tagIds.includes(tag.id);
              return (
                <TagFilterRow
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  selected={selected}
                  onPress={() => toggleTag(tag.id)}
                />
              );
            })
          )}
        </>
      ) : null}

      {page === "status" ? (
        <>
          <ContextMenuItem icon="chevron-back" label="Back" onPress={() => go("root")} />
          {(["all", "unread", "read"] as const).map((status) => (
            <ContextMenuItem
              key={status}
              icon={status === "unread" ? "mail-unread-outline" : status === "read" ? "mail-open-outline" : "layers-outline"}
              label={STATUS_LABEL[status]}
              selected={filters.status === status}
              onPress={() => setStatus(status)}
            />
          ))}
        </>
      ) : null}

      {page === "kind" ? (
        <>
          <ContextMenuItem icon="chevron-back" label="Back" onPress={() => go("root")} />
          {(["all", "article", "web"] as const).map((kind) => (
            <ContextMenuItem
              key={kind}
              icon={kind === "article" ? "document-text-outline" : kind === "web" ? "globe-outline" : "apps-outline"}
              label={KIND_LABEL[kind]}
              selected={filters.kind === kind}
              onPress={() => setKind(kind)}
            />
          ))}
        </>
      ) : null}
    </ContextMenu>
  );
}

function Trailing({ label }: { label: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.trailing}>
      <Text variant="caption" color="tertiary" numberOfLines={1} style={styles.trailingLabel}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={palette.textFaint} />
    </View>
  );
}

function TagFilterRow({
  name,
  color,
  selected,
  onPress,
}: {
  name: string;
  color: TagDto["color"];
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const [hovered, setHovered] = useState(false);
  const highlight = menuHoverFill(palette.mode, true);

  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => {
        haptics.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tagRow,
        Platform.OS === "web" ? styles.tagRowWeb : null,
        (pressed || hovered) ? { backgroundColor: highlight } : null,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tagColorValue(color).dot }]} />
      <Text variant="body" numberOfLines={1} style={styles.tagName}>
        {name}
      </Text>
      {selected ? <Ionicons name="checkmark" size={18} color={palette.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing[4], flexShrink: 0, maxWidth: 120 },
  trailingLabel: { flexShrink: 1 },
  tagSearch: { paddingHorizontal: spacing[4], paddingBottom: spacing[6] },
  empty: { paddingHorizontal: spacing[12], paddingVertical: spacing[12] },
  tagRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingHorizontal: spacing[12],
    borderRadius: radius.lg,
  },
  tagRowWeb: {
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  } as ViewStyle,
  dot: { width: 10, height: 10, borderRadius: 9999 },
  tagName: { flex: 1, minWidth: 0 },
});
