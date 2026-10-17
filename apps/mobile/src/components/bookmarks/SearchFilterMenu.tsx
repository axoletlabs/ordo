/**
 * Nested floating filter menu for global search: folders, tags, read status,
 * article/website, reminders, and optional fuzzy matching.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import type { FolderDto, TagDto } from "@ordo/shared";
import { DEFAULT_FOLDER_ICON } from "@ordo/shared";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { tagColorValue } from "../../lib/tag-colors";
import { type MenuAnchorRect } from "../../lib/menu-anchor";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { spacing } from "../../theme/tokens";
import { useFolderUnlocked } from "../../hooks/use-folders";
import { useServerInfo } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { FolderLockIcon } from "./FolderLockIcon";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { LazyMount } from "../ui/LazyMount";
import {
  EMPTY_SEARCH_FILTERS,
  searchFiltersActive,
  type SearchFilters,
  type SearchKindFilter,
  type SearchReminderFilter,
  type SearchStatusFilter,
} from "../../lib/search-bookmarks";

type FilterPage = "root" | "folders" | "tags" | "status" | "kind" | "reminder";

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

const REMINDER_LABEL: Record<SearchReminderFilter, string> = {
  all: "Any",
  due: "Due",
  upcoming: "Upcoming",
};

export function SearchFilterMenu(props: Parameters<typeof SearchFilterContent>[0]) {
  return <LazyMount active={props.visible}>{() => <SearchFilterContent {...props} />}</LazyMount>;
}

function SearchFilterContent({
  visible,
  onDismiss,
  anchor,
  tags,
  folders,
  filters,
  onChange,
  onUnlockFolder,
}: {
  visible: boolean;
  onDismiss: () => void;
  anchor: MenuAnchorRect | null;
  tags: readonly TagDto[];
  folders: readonly FolderDto[];
  filters: SearchFilters;
  onChange: React.Dispatch<React.SetStateAction<SearchFilters>>;
  onUnlockFolder?: (folder: FolderDto) => void;
}) {
  const { palette } = useTheme();
  const { height, fontScale } = useWindowDimensions();
  const rowHeight = Math.max(48, 24 * fontScale + 16);
  const [headerHeights, setHeaderHeights] = useState({ folders: 0, tags: 0 });
  const remindersSupported = useServerInfo().data?.reminders === true;
  const [page, setPage] = useState<FilterPage>("root");
  const [tagQuery, setTagQuery] = useState("");
  const [folderQuery, setFolderQuery] = useState("");
  const tagList = useRef<FlatList<TagDto>>(null);
  const folderList = useRef<FlatList<FolderDto>>(null);
  const catalogueRoot = useRef<View>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || focusIndex == null) return;
    const root = catalogueRoot.current as unknown as HTMLElement | null;
    if (!root) return;
    let frame = 0;
    const focus = () => {
      const row = root.querySelector<HTMLElement>(`[data-menu-index="${focusIndex}"] [role^="menuitem"]`);
      if (!row) return false;
      row.focus(); row.scrollIntoView({ block: "nearest" });
      setFocusIndex(null);
      return true;
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(focus);
    });
    if (!focus()) observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [visible, page, focusIndex]);

  useEffect(() => {
    if (visible) return;
    setPage("root");
    setTagQuery("");
    setFolderQuery("");
    setFocusIndex(null);
  }, [visible]);

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLocaleLowerCase("en-US");
    const list = q
      ? tags.filter((tag) => tag.name.toLocaleLowerCase("en-US").includes(q))
      : [...tags];
    return list.sort(
      (a, b) =>
        b.bookmarkCount - a.bookmarkCount ||
        a.name.localeCompare(b.name),
    );
  }, [tagQuery, tags]);

  const filteredFolders = useMemo(() => {
    const q = folderQuery.trim().toLocaleLowerCase("en-US");
    const list = q
      ? folders.filter((folder) => folder.name.toLocaleLowerCase("en-US").includes(q))
      : [...folders];
    return list.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        a.name.localeCompare(b.name),
    );
  }, [folderQuery, folders]);

  const go = (next: FilterPage) => {
    setFocusIndex(null);
    setPage(next);
  };

  const setStatus = (status: SearchStatusFilter) => {
    onChange((prev) => ({ ...prev, status }));
    setPage("root");
  };

  const setKind = (kind: SearchKindFilter) => {
    onChange((prev) => ({ ...prev, kind }));
    setPage("root");
  };

  const setReminder = (reminder: SearchReminderFilter) => {
    onChange((prev) => ({ ...prev, reminder }));
    setPage("root");
  };

  const toggleTag = (tagId: string) => {
    onChange((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
  };

  const toggleFolder = (folder: FolderDto) => {
    if (filters.folderIds.includes(folder.id)) {
      onChange((prev) => ({
        ...prev,
        folderIds: prev.folderIds.filter((id) => id !== folder.id),
      }));
      return;
    }
    if (folder.protected && !useFolderTokenStore.getState().get(folder.id)) {
      onUnlockFolder?.(folder);
      return;
    }
    onChange((prev) => ({ ...prev, folderIds: [...prev.folderIds, folder.id] }));
  };

  const toggleUnfiled = () => {
    onChange((prev) => ({ ...prev, unfiled: !prev.unfiled }));
  };

  const toggleFuzzy = () => {
    onChange((prev) => ({ ...prev, fuzzy: !prev.fuzzy }));
  };

  const clear = () => {
    onChange({ ...EMPTY_SEARCH_FILTERS });
    setPage("root");
  };

  const tagSummary =
    filters.tagIds.length === 0
      ? "Any"
      : filters.tagIds.length === 1
        ? (tags.find((tag) => tag.id === filters.tagIds[0])?.name ?? "1 tag")
         : `${filters.tagIds.length} tags`;

  const folderCount = filters.folderIds.length + (filters.unfiled ? 1 : 0);
  const folderSummary =
    folderCount === 0
      ? "Any"
      : folderCount === 1 && filters.unfiled
        ? "Unfiled"
        : folderCount === 1
          ? (folders.find((folder) => folder.id === filters.folderIds[0])?.name ?? "1 folder")
           : `${folderCount} folders`;

  const showUnfiled = !folderQuery.trim() || "unfiled".includes(folderQuery.trim().toLocaleLowerCase("en-US"));

  const navigateCatalogue = (key: string) => {
    if (Platform.OS !== "web" || (page !== "tags" && page !== "folders")) return false;
    const root = catalogueRoot.current as unknown as HTMLElement | null;
    if (!root?.contains(document.activeElement)) return false;
    const list = page === "tags" ? tagList.current : folderList.current;
    const count = page === "tags" ? filteredTags.length : filteredFolders.length;
    const current = document.activeElement?.closest<HTMLElement>("[data-menu-index]")?.dataset.menuIndex;
    if (key === "Home" || key === "ArrowDown" && current === String(count - 1)) {
      setFocusIndex(-1); list?.scrollToOffset({ offset: 0, animated: false }); return true;
    }
    const target = key === "End" || key === "ArrowUp" && current === "-1" ? count - 1
      : key === "ArrowDown" && current != null && Number(current) >= 0 ? Number(current) + 1
        : key === "ArrowUp" && current != null && Number(current) > 0 ? Number(current) - 1 : -1;
    if (target < 0 || !count) return false;
    setFocusIndex(target);
    if (target === count - 1) list?.scrollToEnd({ animated: false });
    else list?.scrollToIndex({ index: target, animated: false });
    return true;
  };

  return (
    <ContextMenu visible={visible} onDismiss={onDismiss} anchor={anchor} width={280} pageKey={page}
      onNavigate={navigateCatalogue}
      scrollBody={page !== "folders" && page !== "tags"}>
      {page === "root" ? (
        <>
          <ContextMenuItem
            icon="folder-outline"
            label="Folders"
            trailing={<Trailing label={folderSummary} />}
            onPress={() => go("folders")}
          />
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
          {remindersSupported ? (
            <ContextMenuItem
              icon="alarm-outline"
              label="Reminders"
              trailing={<Trailing label={REMINDER_LABEL[filters.reminder]} />}
              onPress={() => go("reminder")}
            />
          ) : null}
          <ContextMenuItem
            icon="sparkles-outline"
            label="Fuzzy match"
            selected={filters.fuzzy}
            selectionRole="menuitemcheckbox"
            onPress={toggleFuzzy}
          />
          {searchFiltersActive(filters) ? (
            <ContextMenuItem icon="close-circle-outline" label="Clear filters" onPress={clear} />
          ) : null}
        </>
      ) : null}

      {page === "folders" ? (
        <View ref={catalogueRoot} style={{ flexShrink: 1 }}><ThemedFlatList ref={folderList} key="folders" data={filteredFolders} keyExtractor={(folder) => folder.id}
          getItemLayout={(_data, index) => ({ index, length: rowHeight, offset: headerHeights.folders + rowHeight * index })}
          initialNumToRender={8} maxToRenderPerBatch={6} windowSize={3}
          keyboardShouldPersistTaps="handled" style={{ height: Math.min(360, height * 0.6), flexShrink: 1 }}
          ListHeaderComponent={<View onLayout={(event) => {
            const measured = event.nativeEvent.layout.height;
            setHeaderHeights((current) => current.folders === measured ? current : { ...current, folders: measured });
          }}>
          <View {...(Platform.OS === "web" ? { dataSet: { menuIndex: "-1" } } : {})}><ContextMenuItem icon="chevron-back" label="Back" onPress={() => go("root")} /></View>
          {folders.length > 6 ? (
            <View style={styles.tagSearch}>
              <Input
                variant="search"
                accessibilityLabel="Filter folders"
                value={folderQuery}
                onChangeText={setFolderQuery}
                placeholder="Filter folders…"
                autoCapitalize="none"
                autoCorrect={false}
                icon={<Ionicons name="search-outline" size={24} color={palette.onSurfaceVariant} />}
              />
            </View>
          ) : null}
          {showUnfiled ? (
            <FolderFilterRow
              name="Unfiled"
              icon="bookmark-outline"
              selected={filters.unfiled}
              onPress={toggleUnfiled}
            />
          ) : null}
          </View>}
          ListEmptyComponent={!showUnfiled ? (
            <Text variant="footnote" color="secondary" style={styles.empty}>
              {folderQuery.trim() ? `No folders match “${folderQuery.trim()}”.` : "No folders yet."}
            </Text>
          ) : null}
          renderItem={({ item: folder, index }) => (
              <View {...(Platform.OS === "web" ? { dataSet: { menuIndex: String(index) } } : {})}>
              <FolderFilterRow
                key={folder.id}
                name={folder.name}
                icon={folder.icon ?? DEFAULT_FOLDER_ICON}
                selected={filters.folderIds.includes(folder.id)}
                locked={folder.protected}
                folderId={folder.id}
                onPress={() => toggleFolder(folder)}
              /></View>
          )} /></View>
      ) : null}

      {page === "tags" ? (
        <View ref={catalogueRoot} style={{ flexShrink: 1 }}><ThemedFlatList ref={tagList} key="tags" data={filteredTags} keyExtractor={(tag) => tag.id}
          getItemLayout={(_data, index) => ({ index, length: rowHeight, offset: headerHeights.tags + rowHeight * index })}
          initialNumToRender={8} maxToRenderPerBatch={6} windowSize={3}
          keyboardShouldPersistTaps="handled" style={{ height: Math.min(360, height * 0.6), flexShrink: 1 }}
          ListHeaderComponent={<View onLayout={(event) => {
            const measured = event.nativeEvent.layout.height;
            setHeaderHeights((current) => current.tags === measured ? current : { ...current, tags: measured });
          }}>
          <View {...(Platform.OS === "web" ? { dataSet: { menuIndex: "-1" } } : {})}><ContextMenuItem icon="chevron-back" label="Back" onPress={() => go("root")} /></View>
          {tags.length > 6 ? (
            <View style={styles.tagSearch}>
              <Input
                variant="search"
                accessibilityLabel="Filter tags"
                value={tagQuery}
                onChangeText={setTagQuery}
                placeholder="Filter tags…"
                autoCapitalize="none"
                autoCorrect={false}
                icon={<Ionicons name="search-outline" size={24} color={palette.onSurfaceVariant} />}
              />
            </View>
          ) : null}
          </View>}
          ListEmptyComponent={(
            <Text variant="footnote" color="secondary" style={styles.empty}>
              {tagQuery.trim() ? `No tags match “${tagQuery.trim()}”.` : "No tags yet."}
            </Text>
          )}
          renderItem={({ item: tag, index }) => {
              const selected = filters.tagIds.includes(tag.id);
              return (
                <View {...(Platform.OS === "web" ? { dataSet: { menuIndex: String(index) } } : {})}><TagFilterRow
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  selected={selected}
                  onPress={() => toggleTag(tag.id)}
                /></View>
              );
          }} /></View>
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
              selectionRole="menuitemradio"
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
              selectionRole="menuitemradio"
              onPress={() => setKind(kind)}
            />
          ))}
        </>
      ) : null}

      {remindersSupported && page === "reminder" ? (
        <>
          <ContextMenuItem icon="chevron-back" label="Back" onPress={() => go("root")} />
          {(["all", "due", "upcoming"] as const).map((reminder) => (
            <ContextMenuItem
              key={reminder}
              icon={
                reminder === "due"
                  ? "alert-circle-outline"
                  : reminder === "upcoming"
                    ? "time-outline"
                    : "alarm-outline"
              }
              label={REMINDER_LABEL[reminder]}
              selected={filters.reminder === reminder}
              selectionRole="menuitemradio"
              onPress={() => setReminder(reminder)}
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
      <Text variant="footnote" color="tertiary" numberOfLines={1} style={styles.trailingLabel}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={palette.textFaint} style={iconGlyphStyle(16)} />
    </View>
  );
}

function FolderFilterRow({
  name,
  icon,
  selected,
  locked,
  folderId,
  onPress,
}: {
  name: string;
  icon: string;
  selected: boolean;
  locked?: boolean;
  folderId?: string;
  onPress: () => void;
}) {
  const unlocked = useFolderUnlocked(folderId);
  return <ContextMenuItem label={`${name}${locked ? (unlocked ? ", unlocked" : ", locked") : ""}`}
    icon={icon as keyof typeof Ionicons.glyphMap} selected={selected} selectionRole="menuitemcheckbox" labelLines={1}
    trailing={locked ? <FolderLockIcon unlocked={unlocked} size={18} outline /> : undefined} onPress={onPress} />;
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
  return <ContextMenuItem label={name} selected={selected} selectionRole="menuitemcheckbox" labelLines={1}
    leading={<View style={[styles.dot, { backgroundColor: tagColorValue(color).dot }]} />} onPress={onPress} />;
}

const styles = StyleSheet.create({
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing[4], flexShrink: 0, maxWidth: 120 },
  trailingLabel: { flexShrink: 1, includeFontPadding: false },
  tagSearch: { paddingHorizontal: spacing[12], paddingTop: spacing[4], paddingBottom: spacing[6] },
  empty: { paddingHorizontal: spacing[12], paddingVertical: spacing[12] },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
