/**
 * Nested floating filter menu for global search: folders, tags, read status,
 * article/website, reminders, and optional fuzzy matching.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
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

export function SearchFilterMenu({
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
  const remindersSupported = useServerInfo().data?.reminders === true;
  const [page, setPage] = useState<FilterPage>("root");
  const [tagQuery, setTagQuery] = useState("");
  const [folderQuery, setFolderQuery] = useState("");

  useEffect(() => {
    if (visible) return;
    setPage("root");
    setTagQuery("");
    setFolderQuery("");
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

  return (
    <ContextMenu visible={visible} onDismiss={onDismiss} anchor={anchor} width={280} pageKey={page}>
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
        <>
          <ContextMenuItem icon="chevron-back" label="Back" onPress={() => go("root")} />
          {folders.length > 6 ? (
            <View style={styles.tagSearch}>
              <Input
                value={folderQuery}
                onChangeText={setFolderQuery}
                placeholder="Filter folders…"
                autoCapitalize="none"
                autoCorrect={false}
                icon={<Ionicons name="search-outline" size={16} color={palette.textTertiary} />}
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
          {filteredFolders.length === 0 && !showUnfiled ? (
            <Text variant="footnote" color="secondary" style={styles.empty}>
              {folderQuery.trim() ? `No folders match “${folderQuery.trim()}”.` : "No folders yet."}
            </Text>
          ) : (
            filteredFolders.map((folder) => (
              <FolderFilterRow
                key={folder.id}
                name={folder.name}
                icon={folder.icon ?? DEFAULT_FOLDER_ICON}
                selected={filters.folderIds.includes(folder.id)}
                locked={folder.protected}
                folderId={folder.id}
                onPress={() => toggleFolder(folder)}
              />
            ))
          )}
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
    icon={icon as keyof typeof Ionicons.glyphMap} selected={selected} selectionRole="menuitemcheckbox"
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
  return <ContextMenuItem label={name} selected={selected} selectionRole="menuitemcheckbox"
    leading={<View style={[styles.dot, { backgroundColor: tagColorValue(color).dot }]} />} onPress={onPress} />;
}

const styles = StyleSheet.create({
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing[4], flexShrink: 0, maxWidth: 120 },
  trailingLabel: { flexShrink: 1, includeFontPadding: false },
  tagSearch: { paddingHorizontal: spacing[12], paddingTop: spacing[4], paddingBottom: spacing[6] },
  empty: { paddingHorizontal: spacing[12], paddingVertical: spacing[12] },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
