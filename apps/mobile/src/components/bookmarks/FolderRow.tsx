/**
 * Folder list row — same chrome as BookmarkRow so folders and bookmarks
 * read as one library, not two stacked features.
 */
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { Badge } from "../ui/Badge";
import { SelectionMark } from "./SelectionMark";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { afterPress } from "../../lib/after-press";
import { measureAnchor, menuHoverFill, type MenuAnchorRect } from "../../lib/menu-anchor";
import { radius, spacing } from "../../theme/tokens";
import { folderKey, SELECTION_LONG_PRESS_MS } from "../../hooks/use-selection";
import { useMenuHighlightStore } from "../../hooks/use-menu-highlight";
import { DEFAULT_FOLDER_ICON, type FolderDto } from "@ordo/shared";

export interface FolderRowProps {
  folder: FolderDto;
  onPress: (f: FolderDto) => void;
  onMore?: (f: FolderDto, anchor: MenuAnchorRect) => void;
  selected?: boolean;
  selectionMode?: boolean;
  highlighted?: boolean;
}

export const FolderRow = React.memo(function FolderRow({ folder, onPress, onMore, selected, selectionMode, highlighted: highlightedProp }: FolderRowProps) {
  const { palette } = useTheme();
  const moreRef = React.useRef<View>(null);
  const [hovered, setHovered] = React.useState(false);
  const menuKey = folderKey(folder.id);
  const highlightedFromMenu = useMenuHighlightStore((s) => s.key === menuKey);
  const highlighted = highlightedProp ?? highlightedFromMenu;
  const unread = folder.unreadCount > 0;
  const countLabel = `${folder.bookmarkCount} ${folder.bookmarkCount === 1 ? "bookmark" : "bookmarks"}`;
  const openMore = (event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    measureAnchor(moreRef.current, (anchor) => onMore?.(folder, anchor), event);
  };
  const rowFill = selected || highlighted
    ? palette.surfaceSecondary
    : hovered
      ? menuHoverFill(palette.mode)
      : "transparent";

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: rowFill,
          borderBottomColor: palette.border,
        },
      ]}
      {...(Platform.OS === "web"
        ? {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          }
        : null)}
    >
      <PressableScale
        accessibilityRole={selectionMode ? "checkbox" : "button"}
        accessibilityLabel={`${folder.name}, ${countLabel}${folder.pinned ? ", pinned" : ""}${folder.protected ? ", locked" : ""}${unread ? `, ${folder.unreadCount} unread` : ""}`}
        accessibilityState={selectionMode ? { checked: !!selected } : undefined}
        accessibilityHint={
          selectionMode
            ? selected
              ? "Deselect this folder"
              : "Select this folder"
            : onMore
              ? "Press and hold for more actions"
              : undefined
        }
        style={styles.body}
        onPress={() => {
          if (selectionMode) {
            onPress(folder);
            return;
          }
          haptics.light();
          afterPress(() => onPress(folder));
        }}
        onLongPress={selectionMode ? undefined : onMore ? (event) => openMore(event) : undefined}
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
        <View ref={moreRef} collapsable={false} style={styles.moreBtn}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${folder.name}`}
            onHoverIn={() => setHovered(true)}
            style={({ pressed }) => [
              styles.moreHit,
              (pressed || hovered) && { backgroundColor: menuHoverFill(palette.mode, true) },
            ]}
            onPress={openMore}
            hitSlop={12}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={hovered || highlighted ? palette.textSecondary : palette.textTertiary} />
          </Pressable>
        </View>
      ) : onMore ? (
        <View style={styles.moreBtn} pointerEvents="none" />
      ) : null}
    </View>
  );
});

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
  moreHit: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
  },
});
