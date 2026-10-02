import React from "react";
import { View } from "react-native";
import type { FolderDto, TagDto } from "@ordo/shared";
import { EMPTY_SEARCH_FILTERS, type SearchFilters } from "../../lib/search-bookmarks";
import { TagChip } from "../tags/TagChip";
import { Button } from "../ui/Button";

export function LibraryFilters({ filters, folders, tags, onChange }: {
  filters: SearchFilters; folders: readonly FolderDto[]; tags: readonly TagDto[];
  onChange: React.Dispatch<React.SetStateAction<SearchFilters>>;
}) {
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...folders.filter((folder) => filters.folderIds.includes(folder.id)).map((folder) => ({ key: `folder:${folder.id}`, label: folder.name,
      remove: () => onChange((previous) => ({ ...previous, folderIds: previous.folderIds.filter((id) => id !== folder.id) })) })),
    ...tags.filter((tag) => filters.tagIds.includes(tag.id)).map((tag) => ({ key: `tag:${tag.id}`, label: tag.name,
      remove: () => onChange((previous) => ({ ...previous, tagIds: previous.tagIds.filter((id) => id !== tag.id) })) })),
  ];
  if (filters.unfiled) chips.push({ key: "unfiled", label: "Unfiled", remove: () => onChange((previous) => ({ ...previous, unfiled: false })) });
  if (filters.status !== "all") chips.push({ key: "status", label: filters.status === "unread" ? "Unread" : "Read", remove: () => onChange((previous) => ({ ...previous, status: "all" })) });
  if (filters.kind !== "all") chips.push({ key: "kind", label: filters.kind === "article" ? "Articles" : "Websites", remove: () => onChange((previous) => ({ ...previous, kind: "all" })) });
  if (filters.reminder !== "all") chips.push({ key: "reminder", label: filters.reminder === "due" ? "Due" : "Upcoming", remove: () => onChange((previous) => ({ ...previous, reminder: "all" })) });
  if (filters.fuzzy) chips.push({ key: "fuzzy", label: "Fuzzy", remove: () => onChange((previous) => ({ ...previous, fuzzy: false })) });
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingBottom: 8 }}>
    {chips.map((chip) => <TagChip key={chip.key} name={chip.label} color="slate" selected compact
      accessibilityLabel={`Remove ${chip.label} filter`} onPress={chip.remove} />)}
    <Button label="Clear filters" variant="tonal" size="sm" onPress={() => onChange(EMPTY_SEARCH_FILTERS)} />
  </View>;
}
