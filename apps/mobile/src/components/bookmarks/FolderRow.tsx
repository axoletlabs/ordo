/**
 * Folder list row — same chrome as BookmarkRow so folders and bookmarks
 * read as one library, not two stacked features.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { Badge } from "../ui/Badge";
import { SelectionMark } from "./SelectionMark";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { radius, spacing } from "../../theme/tokens";
import { SELECTION_LONG_PRESS_MS } from "../../hooks/use-selection";
import { DEFAULT_FOLDER_ICON, type FolderDto } from "@ordo/shared";

export interface FolderRowProps {
  folder: FolderDto;
  onPress: (f: FolderDto) => void;
  onMore?: (f: FolderDto) => void;
  onLongPress?: (f: FolderDto) => void;
  selected?: boolean;
  selectionMode?: boolean;
}

export function FolderRow({ folder, onPress, onMore, onLongPress, selected, selectionMode }: FolderRowProps) {
  const { palette } = useTheme();
  const unread = folder.unreadCount > 0;
  const countLabel = `${folder.bookmarkCount} ${folder.bookmarkCount === 1 ? "bookmark" : "bookmarks"}`;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: selected ? palette.surfaceSecondary : "transparent",
          borderBottomColor: palette.border,
        },
      ]}
    >
      <PressableScale
        accessibilityRole={selectionMode ? "checkbox" : "button"}
        accessibilityLabel={`${folder.name}, ${countLabel}${folder.pinned ? ", pinned" : ""}${folder.protected ? ", locked" : ""}${unread ? `, ${folder.unreadCount} unread` : ""}`}
        accessibilityState={selectionMode ? { checked: !!selected } : undefined}
        accessibilityHint={
          selectionMode ? (selected ? "Deselect this folder" : "Select this folder") : undefined
        }
        style={styles.body}
        onPress={() => {
          if (!selectionMode) haptics.light();
          onPress(folder);
        }}
        onLongPress={onLongPress ? () => onLongPress(folder) : onMore ? () => onMore(folder) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        {selectionMode ? (
          <SelectionMark selected={!!selected} />
        ) : (
          <View
            style={[
              styles.iconFrame,
              { backgroundColor: palette.surfaceSecondary, borderColor: palette.border },
            ]}
          >
            <Ionicons name={folder.icon ?? DEFAULT_FOLDER_ICON} size={18} color={palette.accent} />
          </View>
        )}

        <View style={styles.content}>
          <Text variant="headline" numberOfLines={1}>{folder.name}</Text>
          <View style={styles.metaRow}>
            <Text variant="caption" color="tertiary" numberOfLines={1} style={styles.count}>
              {countLabel}
            </Text>
            {folder.protected ? (
              <Ionicons
                name="lock-closed"
                size={12}
                color={palette.textTertiary}
                style={styles.statusIcon}
                accessible={false}
              />
            ) : null}
            {folder.pinned ? (
              <Ionicons
                name="pin"
                size={13}
                color={palette.accent}
                style={styles.statusIcon}
                accessible={false}
              />
            ) : null}
          </View>
        </View>
        {unread && !selectionMode ? <Badge tone="accent">{folder.unreadCount}</Badge> : null}
      </PressableScale>
      {onMore && !selectionMode ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${folder.name}`}
          style={styles.moreBtn}
          scaleTo={0.85}
          onPress={() => onMore(folder)}
          hitSlop={12}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={palette.textTertiary} />
        </PressableScale>
      ) : onMore ? (
        <View style={styles.moreBtn} pointerEvents="none" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: spacing[8],
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingVertical: spacing[12],
    paddingLeft: spacing[16],
    paddingRight: spacing[8],
  },
  iconFrame: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[6], marginTop: spacing[6] },
  count: { flexShrink: 1 },
  statusIcon: { marginLeft: spacing[2] },
  moreBtn: {
    width: 40,
    height: 40,
    marginTop: spacing[10],
    alignItems: "center",
    justifyContent: "center",
  },
});
