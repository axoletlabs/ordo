/**
 * Folder list row — same chrome as BookmarkRow so folders and bookmarks
 * read as one library, not two stacked features.
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { ListPressable } from "../ui/ListPressable";
import { PressableScale } from "../ui/PressableScale";
import { PinIcon } from "../ui/PinIcon";
import { Text } from "../ui/Text";
import { Badge } from "../ui/Badge";
import { RowHighlight } from "./RowHighlight";
import { SelectionMark } from "./SelectionMark";
import { SelectionDragHandle, useSelectionDragRow } from "./SelectionDrag";
import { ThemeOverrideProvider, useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { RowIconWell } from "../ui/RowIconWell";
import { ROW_ICON_GLYPH } from "../../theme/alignment";
import { layout, radius, spacing } from "../../theme/tokens";
import { folderKey, SELECTION_LONG_PRESS_MS, useSelectionHoldGuard } from "../../hooks/use-selection";
import { useMenuHighlightStore } from "../../hooks/use-menu-highlight";
import { prefetchFolderBookmarks } from "../../hooks/use-bookmarks";
import { useFolderUnlocked } from "../../hooks/use-folders";
import { DEFAULT_FOLDER_ICON, type FolderDto } from "@ordo/shared";
import { FolderLockIcon } from "./FolderLockIcon";
import { RowStatusSlot, ROW_STATUS_ICON_SIZE } from "./RowStatusIcon";
import { listCorners, type ListPosition } from "../../theme/list-shape";

export interface FolderRowProps {
  folder: FolderDto;
  onPress: (f: FolderDto) => void;
  onMore?: (f: FolderDto, anchor: MenuAnchorRect) => void;
  /** Press-and-hold on the folder icon enters selection with this folder. */
  onEnterSelection?: (f: FolderDto) => void;
  selected?: boolean;
  selectionMode?: boolean;
  highlighted?: boolean;
  position?: ListPosition;
}

export const FolderRow = React.memo(function FolderRow({ folder, onPress, onMore, onEnterSelection, selected, selectionMode, highlighted: highlightedProp, position = "only" }: FolderRowProps) {
  const { palette: basePalette, expressive } = useTheme();
  const rowRef = React.useRef<View>(null);
  const dragRow = useSelectionDragRow(folderKey(folder.id));
  const bodyStartY = React.useRef(0);
  const bodyMoved = React.useRef(false);
  const leadStartY = React.useRef(0);
  const leadMoved = React.useRef(false);
  const setRowRef = React.useCallback(
    (node: View | null) => {
      rowRef.current = node;
      dragRow.bind(node);
    },
    [dragRow],
  );
  const selectionModeRef = React.useRef(!!selectionMode);
  selectionModeRef.current = !!selectionMode;
  const hold = useSelectionHoldGuard();
  const holdItemId = folder.id;
  const holdItemIdRef = React.useRef(holdItemId);
  if (holdItemIdRef.current !== holdItemId) {
    holdItemIdRef.current = holdItemId;
    hold.reset();
  }
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const menuKey = folderKey(folder.id);
  const highlightedFromMenu = useMenuHighlightStore((s) => s.key === menuKey);
  const highlighted = highlightedProp ?? highlightedFromMenu;
  const palette = React.useMemo(() => selected || highlighted ? {
    ...basePalette, onSurface: basePalette.onSecondaryContainer, onSurfaceVariant: basePalette.onSecondaryContainer,
    text: basePalette.onSecondaryContainer, textSecondary: basePalette.onSecondaryContainer,
    textTertiary: basePalette.onSecondaryContainer, textFaint: basePalette.onSecondaryContainer,
  } : basePalette, [basePalette, selected, highlighted]);
  const unread = folder.unreadCount > 0;
  const sessionUnlocked = useFolderUnlocked(folder.protected ? folder.id : null);
  const countLabel = `${folder.bookmarkCount} ${folder.bookmarkCount === 1 ? "bookmark" : "bookmarks"}`;
  const lockLabel = folder.protected ? (sessionUnlocked ? ", unlocked" : ", locked") : "";
  const openFolder = () => {
    if (dragRow.consumePress()) return;
    if (hold.consumePress()) return;
    if (selectionMode) {
      onPress(folder);
      return;
    }
    haptics.light();
    onPress(folder);
  };

  const warmFolder = () => {
    if (selectionMode || (folder.protected && !sessionUnlocked)) return;
    void prefetchFolderBookmarks(folder.id);
  };
  const openMore = (event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    haptics.light();
    measureAnchor(rowRef.current, (anchor) => onMore?.(folder, anchor), event);
  };
  const rowFill = selected || highlighted
    ? palette.secondaryContainer
    : pressed || hovered
      ? `${palette.onSurface}${pressed ? "1f" : "14"}`
      : "transparent";

  return (
    <ThemeOverrideProvider palette={palette}>
    <View
      ref={setRowRef}
      collapsable={false}
      onLayout={() => dragRow.bind(rowRef.current)}
      style={[styles.wrap, { borderBottomColor: palette.outlineVariant, borderBottomWidth: expressive ? 0 : StyleSheet.hairlineWidth,
         backgroundColor: expressive ? palette.surfaceContainerLow : "transparent", borderRadius: expressive ? radius.lg : 0,
        marginBottom: expressive ? spacing[4] : 0, minHeight: 72 }, expressive ? listCorners(position, !!selected || !!highlighted) : null]}
      {...(Platform.OS === "web"
        ? {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
            onContextMenu:
              onMore && !selectionMode
                ? (event: { preventDefault?: () => void }) => {
                    event.preventDefault?.();
                    openMore();
                  }
                : undefined,
          }
        : null)}
    >
      <RowHighlight color={rowFill} />
      <SelectionDragHandle
        selectionKey={folderKey(folder.id)}
        selectionMode={!!selectionMode}
        onEnter={
          onEnterSelection
            ? () => {
                if (selectionModeRef.current) return;
                hold.markEnter();
                onEnterSelection(folder);
              }
            : undefined
        }
        style={styles.leadingHit}
      >
      <ListPressable
        feedback={false}
        accessibilityRole="button"
        accessibilityLabel={`Select ${folder.name}`}
        accessibilityHint="Press and hold to select"
        accessible={!selectionMode}
        importantForAccessibility={selectionMode ? "no" : "yes"}
        style={styles.leading}
        onTouchStart={(event) => {
          leadStartY.current = event.nativeEvent.pageY;
          leadMoved.current = false;
        }}
        onTouchMove={(event) => {
          if (Math.abs(event.nativeEvent.pageY - leadStartY.current) > 10) leadMoved.current = true;
        }}
        onPressIn={() => {
          setPressed(true);
          hold.pressIn();
          warmFolder();
        }}
        onPressOut={() => { setPressed(false); hold.pressOut(); }}
        onPress={() => {
          if (leadMoved.current) return;
          openFolder();
        }}
      >
        <View pointerEvents="none">
        {selectionMode ? (
          <SelectionMark selected={!!selected} />
        ) : (
          <RowIconWell>
            <Ionicons name={folder.icon ?? DEFAULT_FOLDER_ICON} size={ROW_ICON_GLYPH} color={palette.onSecondaryContainer} />
          </RowIconWell>
        )}
        </View>
      </ListPressable>
      </SelectionDragHandle>

      <ListPressable
        feedback={false}
        accessibilityRole={selectionMode ? "checkbox" : "button"}
        accessibilityLabel={`${folder.name}, ${countLabel}${folder.pinned ? ", pinned" : ""}${lockLabel}${unread ? `, ${folder.unreadCount} unread` : ""}`}
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
        accessibilityActions={
          onMore && !selectionMode ? [{ name: "more", label: "More actions" }] : undefined
        }
        onAccessibilityAction={
          onMore && !selectionMode
            ? (event) => {
                if (event.nativeEvent.actionName === "more") openMore();
              }
            : undefined
        }
        style={styles.body}
        onTouchStart={(event) => {
          bodyStartY.current = event.nativeEvent.pageY;
          bodyMoved.current = false;
        }}
        onTouchMove={(event) => {
          if (Math.abs(event.nativeEvent.pageY - bodyStartY.current) > 10) bodyMoved.current = true;
        }}
        onPressIn={() => {
          setPressed(true);
          hold.pressIn();
          warmFolder();
        }}
        onPressOut={() => { setPressed(false); hold.pressOut(); }}
        onPress={() => {
          if (bodyMoved.current) return;
          openFolder();
        }}
        onLongPress={selectionMode ? undefined : onMore ? (event) => openMore(event) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.titleWrap}>
              <Text variant="headline" numberOfLines={1}>
                {folder.name}
              </Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            {folder.protected ? <RowStatusSlot><FolderLockIcon unlocked={sessionUnlocked} outline /></RowStatusSlot> : null}
            <Text variant="bodyMedium" color="tertiary" numberOfLines={1} style={styles.count}>
              {countLabel}
            </Text>
            {folder.pinned ? <RowStatusSlot><PinIcon size={ROW_STATUS_ICON_SIZE} color={palette.textTertiary} filled={false} /></RowStatusSlot> : null}
          </View>
        </View>
        {unread && !selectionMode ? <Badge tone="accent">{folder.unreadCount}</Badge> : null}
      </ListPressable>
      {onMore && !selectionMode ? <PressableScale accessibilityRole="button" accessibilityLabel={`More actions for ${folder.name}`}
        onPress={(event) => openMore(event)} style={{ width: 48, height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="ellipsis-vertical" size={24} color={palette.onSurfaceVariant} />
      </PressableScale> : onMore ? <View style={{ width: 48, height: 48 }} /> : null}
    </View>
    </ThemeOverrideProvider>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: layout.rowInset,
    overflow: "hidden",
  },
  leadingHit: {
    alignSelf: "stretch",
  },
  leading: {
    alignSelf: "stretch",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing[12],
    paddingLeft: layout.rowInset,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
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
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  titleWrap: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[8], marginTop: spacing[4] },
  count: { flexShrink: 1 },
});
